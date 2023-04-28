import path from 'path';
import os from 'os';
import childProcess from 'child_process';
import fs from 'fs-extra';
import {remote} from 'electron';

import {CompositeDisposable} from 'event-kit';
import {GitProcess} from 'dugite';
import {parse as parseDiff} from 'what-the-diff';
import {parse as parseStatus} from 'what-the-status';

import GitPromptServer from './git-prompt-server';
import GitTempDir from './git-temp-dir';
import AsyncQueue from './async-queue';
import {
  getDugitePath, getSharedModulePath, getAtomHelperPath,
  extractCoAuthorsAndRawCommitMessage, fileExists, isFileExecutable, isFileSymlink, isBinary,
  normalizeGitHelperPath, toNativePathSep, toGitPathSep, LINE_ENDING_REGEX, CO_AUTHOR_REGEX,
} from './helpers';
import GitTimingsView from './views/git-timings-view';
import WorkerManager from './worker-manager';

const MAX_STATUS_OUTPUT_LENGTH = 1024 * 1024 * 10;

let headless = null;
let execPathPromise = null;

export class GitError extends Error {
  constructor(message) {
    super(message);
    this.message = message;
    this.stack = new Error().stack;
  }
}

export class LargeRepoError extends Error {
  constructor(message) {
    super(message);
    this.message = message;
    this.stack = new Error().stack;
  }
}

const DISABLE_COLOR_FLAGS = [
  'branch', 'diff', 'showBranch', 'status', 'ui',
].reduce((acc, type) => {
  acc.unshift('-c', `color.${type}=false`);
  return acc;
}, []);

export default class GitShellOutStrategy {
  static defaultExecArgs = {
    stdin: null,
    useGitPromptServer: false,
    useGpgWrapper: false,
    useGpgAtomPrompt: false,
    writeOperation: false,
  }

  constructor(workingDir, options = {}) {
    this.workingDir = workingDir;
    if (options.queue) {
      this.commandQueue = options.queue;
    } else {
      const parallelism = options.parallelism || Math.max(3, os.cpus().length);
      this.commandQueue = new AsyncQueue({parallelism});
    }

    this.prompt = options.prompt || (query => Promise.reject());
    this.workerManager = options.workerManager;

    if (headless === null) {
      headless = !remote.getCurrentWindow().isVisible();
    }
  }

  /*
   * Provide an asynchronous callback to be used to request input from the user for git operations.
   *
   * `prompt` must be a callable that accepts a query object `{prompt, includeUsername}` and returns a Promise
   * that either resolves with a result object `{[username], password}` or rejects on cancellation.
   */
  setPromptCallback(prompt) {
    this.prompt = prompt;
  }

  // Execute a command and read the output using the embedded Git environment
  async exec(args, options = GitShellOutStrategy.defaultExecArgs) {
    args.unshift(...DISABLE_COLOR_FLAGS);

    /* eslint-disable no-console */
    const {stdin, useGitPromptServer, useGpgWrapper, useGpgAtomPrompt, writeOperation} = options;
    const subscriptions = new CompositeDisposable();
    const diagnosticsEnabled = process.env.ATOM_GITHUB_GIT_DIAGNOSTICS || atom.config.get('github.gitDiagnostics');

    const formattedArgs = `git ${args.join(' ')} in ${this.workingDir}`;
    const timingMarker = GitTimingsView.generateMarker(`git ${args.join(' ')}`);
    timingMarker.mark('queued');

    if (execPathPromise === null) {
      // Attempt to collect the --exec-path from a native git installation.
      execPathPromise = new Promise((resolve, reject) => {
        childProcess.exec('git --exec-path', (error, stdout, stderr) => {
          if (error) {
            // Oh well
            resolve(null);
            return;
          }

          resolve(stdout.trim());
        });
      });
    }
    const execPath = await execPathPromise;

    return this.commandQueue.push(async () => {
      timingMarker.mark('prepare');
      let gitPromptServer;

      const pathParts = [];
      if (process.env.PATH) {
        pathParts.push(process.env.PATH);
      }
      if (execPath) {
        pathParts.push(execPath);
      }

      const env = {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        PATH: pathParts.join(path.delimiter),
      };

      const gitTempDir = new GitTempDir();

      if (useGpgWrapper) {
        await gitTempDir.ensure();
        args.unshift('-c', `gpg.program=${gitTempDir.getGpgWrapperSh()}`);
      }

      if (useGitPromptServer) {
        gitPromptServer = new GitPromptServer(gitTempDir);
        await gitPromptServer.start(this.prompt);

        env.ATOM_GITHUB_TMP = gitTempDir.getRootPath();
        env.ATOM_GITHUB_ASKPASS_PATH = normalizeGitHelperPath(gitTempDir.getAskPassJs());
        env.ATOM_GITHUB_CREDENTIAL_PATH = normalizeGitHelperPath(gitTempDir.getCredentialHelperJs());
        env.ATOM_GITHUB_ELECTRON_PATH = normalizeGitHelperPath(getAtomHelperPath());
        env.ATOM_GITHUB_SOCK_PATH = normalizeGitHelperPath(gitTempDir.getSocketPath());

        env.ATOM_GITHUB_WORKDIR_PATH = this.workingDir;
        env.ATOM_GITHUB_DUGITE_PATH = getDugitePath();
        env.ATOM_GITHUB_KEYTAR_STRATEGY_PATH = getSharedModulePath('keytar-strategy');

        // "ssh" won't respect SSH_ASKPASS unless:
        // (a) it's running without a tty
        // (b) DISPLAY is set to something nonempty
        // But, on a Mac, DISPLAY is unset. Ensure that it is so our SSH_ASKPASS is respected.
        if (!process.env.DISPLAY || process.env.DISPLAY.length === 0) {
          env.DISPLAY = 'atom-github-placeholder';
        }

        env.ATOM_GITHUB_ORIGINAL_PATH = process.env.PATH || '';
        env.ATOM_GITHUB_ORIGINAL_GIT_ASKPASS = process.env.GIT_ASKPASS || '';
        env.ATOM_GITHUB_ORIGINAL_SSH_ASKPASS = process.env.SSH_ASKPASS || '';
        env.ATOM_GITHUB_ORIGINAL_GIT_SSH_COMMAND = process.env.GIT_SSH_COMMAND || '';
        env.ATOM_GITHUB_SPEC_MODE = atom.inSpecMode() ? 'true' : 'false';

        env.SSH_ASKPASS = normalizeGitHelperPath(gitTempDir.getAskPassSh());
        env.GIT_ASKPASS = normalizeGitHelperPath(gitTempDir.getAskPassSh());

        if (process.platform === 'linux') {
          env.GIT_SSH_COMMAND = gitTempDir.getSshWrapperSh();
        } else {
          env.GIT_SSH_COMMAND = process.env.GIT_SSH_COMMAND;
        }

        const credentialHelperSh = normalizeGitHelperPath(gitTempDir.getCredentialHelperSh());
        args.unshift('-c', `credential.helper=${credentialHelperSh}`);
      }

      if (useGpgWrapper && useGitPromptServer && useGpgAtomPrompt) {
        env.ATOM_GITHUB_GPG_PROMPT = 'true';
      }

      if (diagnosticsEnabled) {
        env.GIT_TRACE = 'true';
        env.GIT_TRACE_CURL = 'true';
      }

      let opts = {env};

      if (stdin) {
        opts.stdin = stdin;
        opts.stdinEncoding = 'utf8';
      }

      if (process.env.PRINT_GIT_TIMES) {
        console.time(`git:${formattedArgs}`);
      }
      return new Promise(async (resolve, reject) => {
        if (options.beforeRun) {
          const newArgsOpts = await options.beforeRun({args, opts});
          args = newArgsOpts.args;
          opts = newArgsOpts.opts;
        }
        const {promise, cancel} = this.executeGitCommand(args, opts, timingMarker);
        let expectCancel = false;
        if (gitPromptServer) {
          subscriptions.add(gitPromptServer.onDidCancel(async ({handlerPid}) => {
            expectCancel = true;
            await cancel();

            // On Windows, the SSH_ASKPASS handler is executed as a non-child process, so the bin\git-askpass-atom.sh
            // process does not terminate when the git process is killed.
            // Kill the handler process *after* the git process has been killed to ensure that git doesn't have a
            // chance to fall back to GIT_ASKPASS from the credential handler.
            require('tree-kill')(handlerPid);
          }));
        }

        const {stdout, stderr, exitCode, timing} = await promise.catch(err => {
          reject(err);
          return {};
        });

        if (timing) {
          const {execTime, spawnTime, ipcTime} = timing;
          const now = performance.now();
          timingMarker.mark('nexttick', now - execTime - spawnTime - ipcTime);
          timingMarker.mark('execute', now - execTime - ipcTime);
          timingMarker.mark('ipc', now - ipcTime);
        }
        timingMarker.finalize();
        if (process.env.PRINT_GIT_TIMES) {
          console.timeEnd(`git:${formattedArgs}`);
        }
        if (gitPromptServer) {
          gitPromptServer.terminate();
        }
        subscriptions.dispose();

        if (diagnosticsEnabled) {
          if (headless) {
            let summary = `git:${formattedArgs}\n`;
            summary += `exit status: ${exitCode}\n`;
            summary += 'stdout:';
            if (stdout.length === 0) {
              summary += ' <empty>\n';
            } else {
              summary += `\n${stdout}\n`;
            }
            summary += 'stderr:';
            if (stderr.length === 0) {
              summary += ' <empty>\n';
            } else {
              summary += `\n${stderr}\n`;
            }

            console.log(summary);
          } else {
            const headerStyle = 'font-weight: bold; color: blue;';

            console.groupCollapsed(`git:${formattedArgs}`);
            console.log('%cexit status%c %d', headerStyle, 'font-weight: normal; color: black;', exitCode);
            console.log('%cstdout', headerStyle);
            console.log(stdout);
            console.log('%cstderr', headerStyle);
            console.log(stderr);
            console.groupEnd();
          }
        }

        if (exitCode !== 0 && !expectCancel) {
          const err = new GitError(
            `${formattedArgs} exited with code ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`,
          );
          err.code = exitCode;
          err.stdErr = stderr;
          err.stdOut = stdout;
          err.command = formattedArgs;
          reject(err);
        }
        resolve(stdout);
      });
    }, {parallel: !writeOperation});
    /* eslint-enable no-console */
  }

  async gpgExec(args, options) {
    try {
      return await this.exec(args.slice(), {
        useGpgWrapper: true,
        useGpgAtomPrompt: false,
        ...options,
      });
    } catch (e) {
      if (/gpg failed/.test(e.stdErr)) {
        return await this.exec(args, {
          useGitPromptServer: true,
          useGpgWrapper: true,
          useGpgAtomPrompt: true,
          ...options,
        });
      } else {
        throw e;
      }
    }
  }

  executeGitCommand(args, options, marker = null) {
    if (process.env.ATOM_GITHUB_INLINE_GIT_EXEC || !WorkerManager.getInstance().isReady()) {
      marker && marker.mark('nexttick');

      let childPid;
      options.processCallback = child => {
        childPid = child.pid;

        child.stdin.on('error', err => {
          throw new Error(
            `Error writing to stdin: git ${args.join(' ')} in ${this.workingDir}\n${options.stdin}\n${err}`);
        });
      };

      const promise = GitProcess.exec(args, this.workingDir, options);
      marker && marker.mark('execute');
      return {
        promise,
        cancel: () => childPid && require('tree-kill')(childPid),
      };
    } else {
      const workerManager = this.workerManager || WorkerManager.getInstance();
      return workerManager.request({
        args,
        workingDir: this.workingDir,
        options,
      });
    }
  }

  async resolveDotGitDir() {
    try {
      await fs.stat(this.workingDir); // fails if folder doesn't exist
      const output = await this.exec(['rev-parse', '--resolve-git-dir', path.join(this.workingDir, '.git')]);
      const dotGitDir = output.trim();
      if (path.isAbsolute(dotGitDir)) {
        return toNativePathSep(dotGitDir);
      } else {
        return toNativePathSep(path.resolve(path.join(this.workingDir, dotGitDir)));
      }
    } catch (e) {
      return null;
    }
  }

  init() {
    return this.exec(['init', this.workingDir]);
  }

  /**
   * Staging/Unstaging files and patches and committing
   */
  stageFiles(paths) {
    if (paths.length === 0) { return Promise.resolve(null); }
    const args = ['add'].concat(paths.map(toGitPathSep));
    return this.exec(args, {writeOperation: true});
  }

  unstageFiles(paths, commit = 'HEAD') {
    if (paths.length === 0) { return Promise.resolve(null); }
    const args = ['reset', commit, '--'].concat(paths.map(toGitPathSep));
    return this.exec(args, {writeOperation: true});
  }

  stageFileModeChange(filename, newMode) {
    const indexReadPromise = this.exec(['ls-files', '-s', '--', filename]);
    return this.exec(['update-index', '--cacheinfo', `${newMode},<OID_TBD>,${filename}`], {
      writeOperation: true,
      beforeRun: async function determineArgs({args, opts}) {
        const index = await indexReadPromise;
        const oid = index.substr(7, 40);
        return {
          opts,
          args: ['update-index', '--cacheinfo', `${newMode},${oid},${filename}`],
        };
      },
    });
  }

  stageFileSymlinkChange(filename) {
    return this.exec(['rm', '--cached', filename], {writeOperation: true});
  }

  applyPatch(patch, {index} = {}) {
    const args = ['apply', '-'];
    if (index) { args.splice(1, 0, '--cached'); }
    return this.exec(args, {stdin: patch, writeOperation: true});
  }

  async commit(rawMessage, {allowEmpty, amend, coAuthors} = {}) {
    const args = ['commit', '--cleanup=strip'];

    let msg;

    // if amending and no new message is passed, use last commit's message
    if (amend && rawMessage.length === 0) {
      const {unbornRef, messageBody, messageSubject} = await this.getHeadCommit();
      msg = unbornRef ? rawMessage : `${messageSubject}\n\n${messageBody}`.trim();
    } else {
      msg = rawMessage;
    }

    // add co-author commit trailers if necessary
    if (coAuthors && coAuthors.length > 0) {
      msg = await this.addCoAuthorsToMessage(msg, coAuthors);
    }

    args.push('-m', msg.trim());

    if (amend) { args.push('--amend'); }
    if (allowEmpty) { args.push('--allow-empty'); }
    return this.gpgExec(args, {writeOperation: true});
  }

  addCoAuthorsToMessage(message, coAuthors = []) {
    const trailers = coAuthors.map(author => {
      return {
        token: 'Co-Authored-By',
        value: `${author.name} <${author.email}>`,
      };
    });

    // Ensure that message ends with newline for git-interpret trailers to work
    const msg = `${message.trim()}\n`;

    return trailers.length ? this.mergeTrailers(msg, trailers) : msg;
  }

  /**
   * File Status and Diffs
   */
  async getStatusBundle() {
    const args = ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '--ignore-submodules=dirty', '-z'];
    const output = await this.exec(args);
    if (output.length > MAX_STATUS_OUTPUT_LENGTH) {
      throw new LargeRepoError();
    }

    const results = await parseStatus(output);

    for (const entryType in results) {
      if (Array.isArray(results[entryType])) {
        this.updateNativePathSepForEntries(results[entryType]);
      }
    }

    return results;
  }

  updateNativePathSepForEntries(entries) {
    entries.forEach(entry => {
      // Normally we would avoid mutating responses from other package's APIs, but we control
      // the `what-the-status` module and know there are no side effects.
      // This is a hot code path and by mutating we avoid creating new objects that will just be GC'ed
      if (entry.filePath) {
        entry.filePath = toNativePathSep(entry.filePath);
      }
      if (entry.origFilePath) {
        entry.origFilePath = toNativePathSep(entry.origFilePath);
      }
    });
  }

  async diffFileStatus(options = {}) {
    const args = ['diff', '--name-status', '--no-renames'];
    if (options.staged) { args.push('--staged'); }
    if (options.target) { args.push(options.target); }
    const output = await this.exec(args);

    const statusMap = {
      A: 'added',
      M: 'modified',
      D: 'deleted',
      U: 'unmerged',
    };

    const fileStatuses = {};
    output && output.trim().split(LINE_ENDING_REGEX).forEach(line => {
      const [status, rawFilePath] = line.split('\t');
      const filePath = toNativePathSep(rawFilePath);
      fileStatuses[filePath] = statusMap[status];
    });
    if (!options.staged) {
      const untracked = await this.getUntrackedFiles();
      untracked.forEach(filePath => { fileStatuses[filePath] = 'added'; });
    }
    return fileStatuses;
  }

  async getUntrackedFiles() {
    const output = await this.exec(['ls-files', '--others', '--exclude-standard']);
    if (output.trim() === '') { return []; }
    return output.trim().split(LINE_ENDING_REGEX).map(toNativePathSep);
  }

  async getDiffsForFilePath(filePath, {staged, baseCommit} = {}) {
    let args = ['diff', '--no-prefix', '--no-ext-diff', '--no-renames', '--diff-filter=u'];
    if (staged) { args.push('--staged'); }
    if (baseCommit) { args.push(baseCommit); }
    args = args.concat(['--', toGitPathSep(filePath)]);
    const output = await this.exec(args);

    let rawDiffs = [];
    if (output) {
      rawDiffs = parseDiff(output)
        .filter(rawDiff => rawDiff.status !== 'unmerged');

      for (let i = 0; i < rawDiffs.length; i++) {
        const rawDiff = rawDiffs[i];
        if (rawDiff.oldPath) {
          rawDiff.oldPath = toNativePathSep(rawDiff.oldPath);
        }
        if (rawDiff.newPath) {
          rawDiff.newPath = toNativePathSep(rawDiff.newPath);
        }
      }
    }

    if (!staged && (await this.getUntrackedFiles()).includes(filePath)) {
      // add untracked file
      const absPath = path.join(this.workingDir, filePath);
      const executable = await isFileExecutable(absPath);
      const symlink = await isFileSymlink(absPath);
      const contents = await fs.readFile(absPath, {encoding: 'utf8'});
      const binary = isBinary(contents);
      let mode;
      let realpath;
      if (executable) {
        mode = '100755';
      } else if (symlink) {
        mode = '120000';
        realpath = await fs.realpath(absPath);
      } else {
        mode = '100644';
      }

      rawDiffs.push(buildAddedFilePatch(filePath, binary ? null : contents, mode, realpath));
    }
    if (rawDiffs.length > 2) {
      throw new Error(`Expected between 0 and 2 diffs for ${filePath} but got ${rawDiffs.length}`);
    }
    return rawDiffs;
  }

  /**
   * Miscellaneous getters
   */
  async getCommit(ref) {
    const [commit] = await this.getCommits({max: 1, ref, includeUnborn: true});
    return commit;
  }

  async getHeadCommit() {
    const [headCommit] = await this.getCommits({max: 1, ref: 'HEAD', includeUnborn: true});
    return headCommit;
  }

  async getCommits(options = {}) {
    const {max, ref, includeUnborn} = {max: 1, ref: 'HEAD', includeUnborn: false, ...options};

    // https://git-scm.com/docs/git-log#_pretty_formats
    // %x00 - null byte
    // %H - commit SHA
    // %ae - author email
    // %at - timestamp, UNIX timestamp
    // %s - subject
    // %b - body
    const output = await this.exec([
      'log', '--pretty=format:%H%x00%ae%x00%at%x00%s%x00%b', '--no-abbrev-commit', '-z', '-n', max, ref, '--',
    ]).catch(err => {
      if (/unknown revision/.test(err.stdErr) || /bad revision 'HEAD'/.test(err.stdErr)) {
        return '';
      } else {
        throw err;
      }
    });

    if (output === '') {
      return includeUnborn ? [{sha: '', message: '', unbornRef: true}] : [];
    }

    const fields = output.trim().split('\0');
    const commits = [];
    for (let i = 0; i < fields.length; i += 5) {
      const body = fields[i + 4];

      const {message: messageBody, coAuthors} = extractCoAuthorsAndRawCommitMessage(body);

      commits.push({
        sha: fields[i] && fields[i].trim(),
        authorEmail: fields[i + 1] && fields[i + 1].trim(),
        authorDate: parseInt(fields[i + 2], 10),
        messageSubject: fields[i + 3],
        messageBody,
        coAuthors,
        unbornRef: false,
      });
    }
    return commits;
  }

  async getAuthors(options = {}) {
    const {max, ref} = {max: 1, ref: 'HEAD', ...options};

    // https://git-scm.com/docs/git-log#_pretty_formats
    // %x1F - field separator byte
    // %an - author name
    // %ae - author email
    // %cn - committer name
    // %ce - committer email
    // %(trailers:unfold,only) - the commit message trailers, separated
    //                           by newlines and unfolded (i.e. properly
    //                           formatted and one trailer per line).

    const delimiter = '1F';
    const delimiterString = String.fromCharCode(parseInt(delimiter, 16));
    const fields = ['%an', '%ae', '%cn', '%ce', '%(trailers:unfold,only)'];
    const format = fields.join(`%x${delimiter}`);

    try {
      const output = await this.exec([
        'log', `--format=${format}`, '-z', '-n', max, ref, '--',
      ]);

      return output.split('\0')
        .reduce((acc, line) => {
          if (line.length === 0) { return acc; }

          const [an, ae, cn, ce, trailers] = line.split(delimiterString);
          trailers
            .split('\n')
            .map(trailer => trailer.match(CO_AUTHOR_REGEX))
            .filter(match => match !== null)
            .forEach(([_, name, email]) => { acc[email] = name; });

          acc[ae] = an;
          acc[ce] = cn;

          return acc;
        }, {});
    } catch (err) {
      if (/unknown revision/.test(err.stdErr) || /bad revision 'HEAD'/.test(err.stdErr)) {
        return [];
      } else {
        throw err;
      }
    }
  }

  mergeTrailers(commitMessage, trailers, unfold) {
    const args = ['interpret-trailers'];
    if (unfold) {
      args.push('--unfold');
    }
    for (const trailer of trailers) {
      args.push('--trailer', `${trailer.token}=${trailer.value}`);
    }
    return this.exec(args, {stdin: commitMessage});
  }

  readFileFromIndex(filePath) {
    return this.exec(['show', `:${toGitPathSep(filePath)}`]);
  }

  /**
   * Merge
   */
  merge(branchName) {
    return this.gpgExec(['merge', branchName], {writeOperation: true});
  }

  isMerging(dotGitDir) {
    return fileExists(path.join(dotGitDir, 'MERGE_HEAD')).catch(() => false);
  }

  abortMerge() {
    return this.exec(['merge', '--abort'], {writeOperation: true});
  }

  checkoutSide(side, paths) {
    if (paths.length === 0) {
      return Promise.resolve();
    }

    return this.exec(['checkout', `--${side}`, ...paths.map(toGitPathSep)]);
  }

  /**
   * Rebase
   */
  async isRebasing(dotGitDir) {
    const results = await Promise.all([
      fileExists(path.join(dotGitDir, 'rebase-merge')),
      fileExists(path.join(dotGitDir, 'rebase-apply')),
    ]);
    return results.some(r => r);
  }

  /**
   * Remote interactions
   */
  clone(remoteUrl, options = {}) {
    const args = ['clone'];
    if (options.noLocal) { args.push('--no-local'); }
    if (options.bare) { args.push('--bare'); }
    if (options.recursive) { args.push('--recursive'); }
    args.push(remoteUrl, this.workingDir);

    return this.exec(args, {useGitPromptServer: true, writeOperation: true});
  }

  fetch(remoteName, branchName) {
    return this.exec(['fetch', remoteName, branchName], {useGitPromptServer: true, writeOperation: true});
  }

  pull(remoteName, branchName) {
    return this.gpgExec(['pull', remoteName, branchName], {useGitPromptServer: true, writeOperation: true});
  }

  push(remoteName, branchName, options = {}) {
    const args = ['push', remoteName || 'origin', `refs/heads/${branchName}`];
    if (options.setUpstream) { args.push('--set-upstream'); }
    if (options.force) { args.push('--force'); }
    return this.exec(args, {useGitPromptServer: true, writeOperation: true});
  }

  /**
   * Undo Operations
   */
  reset(type, revision = 'HEAD') {
    const validTypes = ['soft'];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid type ${type}. Must be one of: ${validTypes.join(', ')}`);
    }
    return this.exec(['reset', `--${type}`, revision]);
  }

  /**
   * Branches
   */
  checkout(branchName, options = {}) {
    const args = ['checkout'];
    if (options.createNew) { args.push('-b'); }
    return this.exec(args.concat(branchName), {writeOperation: true});
  }

  async getBranches() {
    const format = [
      '%(objectname)', '%(HEAD)', '%(refname:short)',
      '%(upstream)', '%(upstream:remotename)', '%(upstream:remoteref)',
      '%(push)', '%(push:remotename)', '%(push:remoteref)',
    ].join('%00');

    const output = await this.exec(['for-each-ref', `--format=${format}`, 'refs/heads/**']);
    return output.trim().split(LINE_ENDING_REGEX).map(line => {
      const [
        sha, head, name,
        upstreamTrackingRef, upstreamRemoteName, upstreamRemoteRef,
        pushTrackingRef, pushRemoteName, pushRemoteRef,
      ] = line.split('\0');

      const branch = {name, sha, head: head === '*'};
      if (upstreamTrackingRef || upstreamRemoteName || upstreamRemoteRef) {
        branch.upstream = {
          trackingRef: upstreamTrackingRef,
          remoteName: upstreamRemoteName,
          remoteRef: upstreamRemoteRef,
        };
      }
      if (branch.upstream || pushTrackingRef || pushRemoteName || pushRemoteRef) {
        branch.push = {
          trackingRef: pushTrackingRef,
          remoteName: pushRemoteName || (branch.upstream && branch.upstream.remoteName),
          remoteRef: pushRemoteRef || (branch.upstream && branch.upstream.remoteRef),
        };
      }
      return branch;
    });
  }

  checkoutFiles(paths, revision) {
    if (paths.length === 0) { return null; }
    const args = ['checkout'];
    if (revision) { args.push(revision); }
    return this.exec(args.concat('--', paths.map(toGitPathSep)), {writeOperation: true});
  }

  async describeHead() {
    return (await this.exec(['describe', '--contains', '--all', '--always', 'HEAD'])).trim();
  }

  async getConfig(option, {local} = {}) {
    let output;
    try {
      let args = ['config'];
      if (local) { args.push('--local'); }
      args = args.concat(option);
      output = await this.exec(args);
    } catch (err) {
      if (err.code === 1) {
        // No matching config found
        return null;
      } else {
        throw err;
      }
    }

    return output.trim();
  }

  setConfig(option, value, {replaceAll} = {}) {
    let args = ['config'];
    if (replaceAll) { args.push('--replace-all'); }
    args = args.concat(option, value);
    return this.exec(args, {writeOperation: true});
  }

  unsetConfig(option) {
    return this.exec(['config', '--unset', option], {writeOperation: true});
  }

  async getRemotes() {
    let output = await this.getConfig(['--get-regexp', '^remote\\..*\\.url$'], {local: true});
    if (output) {
      output = output.trim();
      if (!output.length) { return []; }
      return output.split('\n').map(line => {
        const match = line.match(/^remote\.(.*)\.url (.*)$/);
        return {
          name: match[1],
          url: match[2],
        };
      });
    } else {
      return [];
    }
  }

  async createBlob({filePath, stdin} = {}) {
    let output;
    if (filePath) {
      try {
        output = (await this.exec(['hash-object', '-w', filePath], {writeOperation: true})).trim();
      } catch (e) {
        if (e.stdErr && e.stdErr.match(/fatal: Cannot open .*: No such file or directory/)) {
          output = null;
        } else {
          throw e;
        }
      }
    } else if (stdin) {
      output = (await this.exec(['hash-object', '-w', '--stdin'], {stdin, writeOperation: true})).trim();
    } else {
      throw new Error('Must supply file path or stdin');
    }
    return output;
  }

  async expandBlobToFile(absFilePath, sha) {
    const output = await this.exec(['cat-file', '-p', sha]);
    await fs.writeFile(absFilePath, output, {encoding: 'utf8'});
    return absFilePath;
  }

  async getBlobContents(sha) {
    return await this.exec(['cat-file', '-p', sha]);
  }

  async mergeFile(oursPath, commonBasePath, theirsPath, resultPath) {
    const args = [
      'merge-file', '-p', oursPath, commonBasePath, theirsPath,
      '-L', 'current', '-L', 'after discard', '-L', 'before discard',
    ];
    let output;
    let conflict = false;
    try {
      output = await this.exec(args);
    } catch (e) {
      if (e instanceof GitError && e.code === 1) {
        output = e.stdOut;
        conflict = true;
      } else {
        throw e;
      }
    }

    // Interpret a relative resultPath as relative to the repository working directory for consistency with the
    // other arguments.
    const resolvedResultPath = path.resolve(this.workingDir, resultPath);
    await fs.writeFile(resolvedResultPath, output, {encoding: 'utf8'});

    return {filePath: oursPath, resultPath, conflict};
  }

  async writeMergeConflictToIndex(filePath, commonBaseSha, oursSha, theirsSha) {
    const gitFilePath = toGitPathSep(filePath);
    const fileMode = await this.getFileMode(filePath);
    let indexInfo = `0 0000000000000000000000000000000000000000\t${gitFilePath}\n`;
    if (commonBaseSha) { indexInfo += `${fileMode} ${commonBaseSha} 1\t${gitFilePath}\n`; }
    if (oursSha) { indexInfo += `${fileMode} ${oursSha} 2\t${gitFilePath}\n`; }
    if (theirsSha) { indexInfo += `${fileMode} ${theirsSha} 3\t${gitFilePath}\n`; }
    return this.exec(['update-index', '--index-info'], {stdin: indexInfo, writeOperation: true});
  }

  async getFileMode(filePath) {
    const output = await this.exec(['ls-files', '--stage', '--', toGitPathSep(filePath)]);
    if (output) {
      return output.slice(0, 6);
    } else {
      const executable = await isFileExecutable(path.join(this.workingDir, filePath));
      const symlink = await isFileSymlink(path.join(this.workingDir, filePath));
      if (executable) {
        return '100755';
      } else if (symlink) {
        return '120000';
      } else {
        return '100644';
      }
    }
  }

  destroy() {
    this.commandQueue.dispose();
  }
}

function buildAddedFilePatch(filePath, contents, mode, realpath) {
  const hunks = [];
  if (contents) {
    const noNewLine = contents[contents.length - 1] !== '\n';
    let lines;
    if (mode === '120000') {
      lines = [`+${toGitPathSep(realpath)}`, '\\ No newline at end of file'];
    } else {
      lines = contents.trim().split(LINE_ENDING_REGEX).map(line => `+${line}`);
    }
    if (noNewLine) { lines.push('\\ No newline at end of file'); }
    hunks.push({
      lines,
      oldStartLine: 0,
      oldLineCount: 0,
      newStartLine: 1,
      heading: '',
      newLineCount: noNewLine ? lines.length - 1 : lines.length,
    });
  }
  return {
    oldPath: null,
    newPath: toNativePathSep(filePath),
    oldMode: null,
    newMode: mode,
    status: 'added',
    hunks,
  };
}