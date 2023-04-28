import {Emitter} from 'event-kit';

import Patch, {COLLAPSED} from './patch';
  static createHiddenFilePatch(oldFile, newFile, marker, renderStatus, showFn) {
    return new this(oldFile, newFile, Patch.createHiddenPatch(marker, renderStatus, showFn));
  }


    this.emitter = new Emitter();
  getRenderStatus() {
    return this.patch.getRenderStatus();
  }

  updateMarkers(map) {
    return this.patch.updateMarkers(map);
  }

  triggerCollapseIn(patchBuffer) {
    if (!this.patch.getRenderStatus().isVisible()) {
      return false;
    }

    const oldPatch = this.patch;
    const position = oldPatch.getRange().start.copy();
    const {patchBuffer: subPatchBuffer, markerMap} = patchBuffer.extractPatchBuffer(oldPatch.getRange());
    oldPatch.destroyMarkers();
    oldPatch.updateMarkers(markerMap);

    const patchMarker = patchBuffer.markPosition(Patch.layerName, position, {invalidate: 'never', exclude: true});
    this.patch = Patch.createHiddenPatch(patchMarker, COLLAPSED, () => {
      return {patch: oldPatch, patchBuffer: subPatchBuffer};
    });

    this.didChangeRenderStatus();
    return true;
  }

  triggerExpandIn(patchBuffer, {before, after}) {
    if (this.patch.getRenderStatus().isVisible()) {
      return false;
    }

    const {patch: nextPatch, patchBuffer: subPatchBuffer} = this.patch.show();
    const atStart = this.patch.getInsertionPoint().isEqual([0, 0]);

    patchBuffer
      .createInserterAt(this.patch.getInsertionPoint())
      .keepBefore(before)
      .keepAfter(after)
      .insert(atStart ? '' : '\n')
      .insertPatchBuffer(subPatchBuffer, {callback: map => nextPatch.updateMarkers(map)})
      .apply();

    this.patch.destroyMarkers();
    this.patch = nextPatch;
    this.didChangeRenderStatus();
    return true;
  }

  didChangeRenderStatus() {
    return this.emitter.emit('change-render-status', this);
  }

  onDidChangeRenderStatus(callback) {
    return this.emitter.on('change-render-status', callback);
  }

  getStartingMarkers() {
    return this.patch.getStartingMarkers();
  }

  getEndingMarkers() {
    return this.patch.getEndingMarkers();
  }

  /*
   * Construct a String containing diagnostic information about the internal state of this FilePatch.
   */
  inspect(opts = {}) {
    const options = {
      indent: 0,
      ...opts,
    };

    let indentation = '';
    for (let i = 0; i < options.indent; i++) {
      indentation += ' ';
    }

    let inspectString = `${indentation}(FilePatch `;
    if (this.getOldPath() !== this.getNewPath()) {
      inspectString += `oldPath=${this.getOldPath()} newPath=${this.getNewPath()}`;
    } else {
      inspectString += `path=${this.getPath()}`;
    }
    inspectString += '\n';

    inspectString += this.patch.inspect({indent: options.indent + 2});

    inspectString += `${indentation})\n`;
    return inspectString;
  }
