import Patch, {DEFERRED, COLLAPSED, EXPANDED} from '../../../lib/models/patch/patch';
import PatchBuffer from '../../../lib/models/patch/patch-buffer';
import {multiFilePatchBuilder} from '../../builder/patch';
    const marker = markRange(layers.patch, 0, 2);
    const patch = new Patch({status: 'modified', hunks, marker});

    assert.strictEqual(filePatch.getMarker(), marker);
    assert.deepEqual(filePatch.getFirstChangeRange().serialize(), [[1, 0], [1, Infinity]]);
    assert.isTrue(filePatch.containsRow(0));
    assert.isFalse(filePatch.containsRow(3));
    const nMarker = markRange(layers.patch, 0, 2);
    filePatch.updateMarkers(new Map([[marker, nMarker]]));
    assert.strictEqual(filePatch.getMarker(), nMarker);
  it('returns the starting range of the patch', function() {
    const buffer = new TextBuffer({text: '0000\n0001\n0002\n0003\n'});
        oldStartRow: 2, oldRowCount: 1, newStartRow: 2, newRowCount: 3,
        marker: markRange(layers.hunk, 1, 3),
          new Unchanged(markRange(layers.unchanged, 1)),
          new Addition(markRange(layers.addition, 2, 3)),
    const marker = markRange(layers.patch, 1, 3);
    const patch = new Patch({status: 'modified', hunks, buffer, layers, marker});
    assert.deepEqual(filePatch.getStartRange().serialize(), [[1, 0], [1, 0]]);
      assert.isFalse(new FilePatch(nonExecutableFile, nullFile).didChangeExecutableMode());
      assert.isFalse(new FilePatch(executableFile, nullFile).didChangeExecutableMode());
      assert.isFalse(new FilePatch(nonSymlinkFile, nullFile).hasTypechange());
      assert.isFalse(new FilePatch(symlinkFile, nullFile).hasTypechange());
      assert.isFalse(new FilePatch(nonSymlinkFile, nullFile).hasSymlink());
      assert.isTrue(new FilePatch(symlinkFile, nullFile).hasSymlink());
  describe('buildStagePatchForLines()', function() {
    let stagedPatchBuffer;

    beforeEach(function() {
      stagedPatchBuffer = new PatchBuffer();
    });

      const marker = markRange(layers.patch, 0, 4);
      const patch = new Patch({status: 'modified', hunks, marker});
      const stagedPatch = filePatch.buildStagePatchForLines(buffer, stagedPatchBuffer, new Set([1, 3]));
      assert.strictEqual(stagedPatch.getOldFile(), oldFile);
      assert.strictEqual(stagedPatch.getNewFile(), newFile);
      assert.strictEqual(stagedPatchBuffer.buffer.getText(), '0000\n0001\n0003\n0004\n');
      assertInFilePatch(stagedPatch, stagedPatchBuffer.buffer).hunks(
      let buffer;
      let oldFile, deletionPatch;
        buffer = new TextBuffer({text: '0000\n0001\n0002\n'});
        const marker = markRange(layers.patch, 0, 2);
        const patch = new Patch({status: 'deleted', hunks, marker});
        oldFile = new File({path: 'file.txt', mode: '100644'});
        const stagedPatch = deletionPatch.buildStagePatchForLines(buffer, stagedPatchBuffer, new Set([1, 2]));
        assert.strictEqual(stagedPatch.getOldFile(), oldFile);
        assert.strictEqual(stagedPatch.getNewFile(), oldFile);
        assert.strictEqual(stagedPatchBuffer.buffer.getText(), '0000\n0001\n0002\n');
        assertInFilePatch(stagedPatch, stagedPatchBuffer.buffer).hunks(
        const stagedPatch = deletionPatch.buildStagePatchForLines(buffer, stagedPatchBuffer, new Set([0, 1, 2]));
        assert.strictEqual(stagedPatch.getOldFile(), oldFile);
        assert.strictEqual(stagedPatchBuffer.buffer.getText(), '0000\n0001\n0002\n');
        assertInFilePatch(stagedPatch, stagedPatchBuffer.buffer).hunks(
        const nBuffer = new TextBuffer({text: '0000\n0001\n0002\n'});
        const layers = buildLayers(nBuffer);
        const marker = markRange(layers.patch, 0, 2);
        const patch = new Patch({status: 'deleted', hunks, marker});
        oldFile = new File({path: 'file.txt', mode: '100644'});
        const stagedPatch = replacePatch.buildStagePatchForLines(nBuffer, stagedPatchBuffer, new Set([0, 1, 2]));
        assert.strictEqual(stagedPatch.getOldFile(), oldFile);
  describe('getUnstagePatchForLines()', function() {
    let unstagePatchBuffer;
    beforeEach(function() {
      unstagePatchBuffer = new PatchBuffer();
    });
      const marker = markRange(layers.patch, 0, 4);
      const patch = new Patch({status: 'modified', hunks, marker});
      const unstagedPatch = filePatch.buildUnstagePatchForLines(buffer, unstagePatchBuffer, new Set([1, 3]));
      assert.strictEqual(unstagedPatch.getOldFile(), newFile);
      assert.strictEqual(unstagedPatch.getNewFile(), newFile);
      assert.strictEqual(unstagePatchBuffer.buffer.getText(), '0000\n0001\n0002\n0003\n0004\n');
      assertInFilePatch(unstagedPatch, unstagePatchBuffer.buffer).hunks(
      let buffer;
        buffer = new TextBuffer({text: '0000\n0001\n0002\n'});
        const marker = markRange(layers.patch, 0, 2);
        addedPatch = new Patch({status: 'added', hunks, marker});
        const unstagePatch = addedFilePatch.buildUnstagePatchForLines(buffer, unstagePatchBuffer, new Set([2]));
        assert.strictEqual(unstagePatch.getOldFile(), newFile);
        assert.strictEqual(unstagePatch.getNewFile(), newFile);
        assertInFilePatch(unstagePatch, unstagePatchBuffer.buffer).hunks(
        const unstagePatch = addedFilePatch.buildUnstagePatchForLines(buffer, unstagePatchBuffer, new Set([0, 1, 2]));
        assert.strictEqual(unstagePatch.getOldFile(), newFile);
        assert.isFalse(unstagePatch.getNewFile().isPresent());
        assertInFilePatch(unstagePatch, unstagePatchBuffer.buffer).hunks(
      it('unsets the newFile when a symlink is deleted and a file is created in its place', function() {
        const unstagePatch = patch.buildUnstagePatchForLines(buffer, unstagePatchBuffer, new Set([0, 1, 2]));
        assert.strictEqual(unstagePatch.getOldFile(), newFile);
        assert.isFalse(unstagePatch.getNewFile().isPresent());
        assertInFilePatch(unstagePatch, unstagePatchBuffer.buffer).hunks(
    describe('unstaging lines from a removed file', function() {
      let oldFile, removedFilePatch, buffer;
      beforeEach(function() {
        buffer = new TextBuffer({text: '0000\n0001\n0002\n'});
        const layers = buildLayers(buffer);
        const hunks = [
          new Hunk({
            oldStartRow: 1, oldRowCount: 0, newStartRow: 1, newRowCount: 3,
            marker: markRange(layers.hunk, 0, 2),
            regions: [
              new Deletion(markRange(layers.deletion, 0, 2)),
            ],
          }),
        ];
        oldFile = new File({path: 'file.txt', mode: '100644'});
        const marker = markRange(layers.patch, 0, 2);
        const removedPatch = new Patch({status: 'deleted', hunks, marker});
        removedFilePatch = new FilePatch(oldFile, nullFile, removedPatch);
      });

      it('handles unstaging part of the file', function() {
        const discardPatch = removedFilePatch.buildUnstagePatchForLines(buffer, unstagePatchBuffer, new Set([1]));
        assert.strictEqual(discardPatch.getStatus(), 'added');
        assert.strictEqual(discardPatch.getOldFile(), nullFile);
        assert.strictEqual(discardPatch.getNewFile(), oldFile);
        assertInFilePatch(discardPatch, unstagePatchBuffer.buffer).hunks(
          {
            startRow: 0,
            endRow: 0,
            header: '@@ -1,0 +1,1 @@',
            regions: [
              {kind: 'addition', string: '+0001\n', range: [[0, 0], [0, 4]]},
            ],
          },
        );
      });

      it('handles unstaging the entire file', function() {
        const discardPatch = removedFilePatch.buildUnstagePatchForLines(
          buffer,
          unstagePatchBuffer,
          new Set([0, 1, 2]),
        );
        assert.strictEqual(discardPatch.getStatus(), 'added');
        assert.strictEqual(discardPatch.getOldFile(), nullFile);
        assert.strictEqual(discardPatch.getNewFile(), oldFile);
        assertInFilePatch(discardPatch, unstagePatchBuffer.buffer).hunks(
          {
            startRow: 0,
            endRow: 2,
            header: '@@ -1,0 +1,3 @@',
            regions: [
              {kind: 'addition', string: '+0000\n+0001\n+0002\n', range: [[0, 0], [2, 4]]},
            ],
          },
        );
      });
    });
  describe('toStringIn()', function() {
      const marker = markRange(layers.patch, 0, 7);
      const patch = new Patch({status: 'modified', hunks, marker});
      assert.strictEqual(filePatch.toStringIn(buffer), expectedString);
      const marker = markRange(layers.patch, 0, 2);
      const patch = new Patch({status: 'modified', hunks, marker});
      assert.strictEqual(filePatch.toStringIn(buffer), expectedString);
        const marker = markRange(layers.patch, 0, 1);
        const patch = new Patch({status: 'added', hunks, marker});
        assert.strictEqual(filePatch.toStringIn(buffer), expectedString);
        const marker = markRange(layers.patch, 0, 1);
        const patch = new Patch({status: 'deleted', hunks, marker});
        assert.strictEqual(filePatch.toStringIn(buffer), expectedString);
    assert.isFalse(nullFilePatch.buildStagePatchForLines(new Set([0])).isPresent());
    assert.isFalse(nullFilePatch.buildUnstagePatchForLines(new Set([0])).isPresent());
    assert.strictEqual(nullFilePatch.toStringIn(new TextBuffer()), '');
  });

  describe('render status changes', function() {
    let sub;

    afterEach(function() {
      sub && sub.dispose();
    });

    it('announces the collapse of an expanded patch', function() {
      const {multiFilePatch} = multiFilePatchBuilder().addFilePatch().build();
      const filePatch = multiFilePatch.getFilePatches()[0];
      const callback = sinon.spy();
      sub = filePatch.onDidChangeRenderStatus(callback);

      assert.strictEqual(EXPANDED, filePatch.getRenderStatus());

      multiFilePatch.collapseFilePatch(filePatch);

      assert.strictEqual(COLLAPSED, filePatch.getRenderStatus());
      assert.isTrue(callback.calledWith(filePatch));
    });

    it('triggerCollapseIn returns false if patch is not visible', function() {
      const {multiFilePatch} = multiFilePatchBuilder()
        .addFilePatch(fp => {
          fp.renderStatus(DEFERRED);
        }).build();
      const filePatch = multiFilePatch.getFilePatches()[0];
      assert.isFalse(filePatch.triggerCollapseIn(new PatchBuffer(), {before: [], after: []}));
    });

    it('triggerCollapseIn does not delete the trailing line if the collapsed patch has no content', function() {
      const {multiFilePatch} = multiFilePatchBuilder()
        .addFilePatch(fp => {
          fp.setOldFile(f => f.path('0.txt'));
          fp.addHunk(h => h.added('0'));
        })
        .addFilePatch(fp => {
          fp.setOldFile(f => f.path('1.txt'));
          fp.setNewFile(f => f.path('1.txt').executable());
          fp.empty();
        })
        .build();

      assert.strictEqual(multiFilePatch.getBuffer().getText(), '0');

      multiFilePatch.collapseFilePatch(multiFilePatch.getFilePatches()[1]);

      assert.strictEqual(multiFilePatch.getBuffer().getText(), '0');
    });

    it('announces the expansion of a collapsed patch', function() {
      const {multiFilePatch} = multiFilePatchBuilder()
        .addFilePatch(fp => {
          fp.renderStatus(COLLAPSED);
        }).build();
      const filePatch = multiFilePatch.getFilePatches()[0];

      const callback = sinon.spy();
      sub = filePatch.onDidChangeRenderStatus(callback);

      assert.deepEqual(COLLAPSED, filePatch.getRenderStatus());
      multiFilePatch.expandFilePatch(filePatch);

      assert.deepEqual(EXPANDED, filePatch.getRenderStatus());
      assert.isTrue(callback.calledWith(filePatch));
    });

    it('does not announce non-changes', function() {
      const {multiFilePatch} = multiFilePatchBuilder().addFilePatch().build();
      const filePatch = multiFilePatch.getFilePatches()[0];

      const callback = sinon.spy();
      sub = filePatch.onDidChangeRenderStatus(callback);

      assert.deepEqual(EXPANDED, filePatch.getRenderStatus());

      multiFilePatch.expandFilePatch(filePatch);
      assert.isFalse(callback.called);
    });
    patch: buffer.addMarkerLayer(),