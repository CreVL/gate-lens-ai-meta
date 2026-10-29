// Shared presentation and 3D evidence bridge for standalone and official preview.
export function inspectionView(state) {
  const i = state.inspection, p = state.presentation;
  const result = (title, detail, status, actions) => ({title, detail, status, actions});
  if (!state.event) return result('Truck inspection', 'Look at the truck to load its assignment.', 'waiting', []);
  if (state.decision !== 'valid') return result('Inspection unavailable', state.reason, 'blocked', []);
  const pair = `Expected ${i.expectedSeal} / Read ${i.observedSeal || '—'}`;
  switch (i.step) {
    case 'ready': return result('Ready to inspect', `${p.destination} · Driver ${p.driver}`, 'waiting', [['start','Start inspection']]);
    case 'trailer': return result('1 / 4 · Check trailer', `Confirm trailer ${p.trailer} on this assignment.`, 'inspection', [['trailer','Trailer confirmed']]);
    case 'seal': return result('2 / 4 · Photograph seal', `${i.expectedSeal ? 'Expected '+i.expectedSeal : 'Registration: no reference number'}. Aim at the label (G), then capture.`, 'inspection', [['capture','Capture and read seal']]);
    case 'photo_pending': return result('Capturing evidence', 'Keep this 3D tab focused. The actual view is photographed.', 'photo', [['capture','Retry capture']]);
    case 'analyzing': return result('Reading the photograph', 'Local OCR is detecting the label and reading its number. No task number is supplied to OCR.', 'photo', [['capture','Retake']]);
    case 'photo_review': {
      const a=i.assessment,readable=a?.status==='readable';
      return result(readable?'3 / 4 · Verify read number':'Photo needs attention', readable?`Read ${a.number} · OCR confidence ${Math.round(a.confidence)}%. Check the image before accepting.`:a?.reason||'Recognition unavailable.', readable?'photo':'incident', readable?[['accept-photo','Accept read number'],['capture','Retake']]:[['capture','Retake'],['report','Report for review']]);
    }
    case 'review': return result('4 / 4 · Review', `${pair}. ${i.flow==='register'?'Register the observed seal; no reference was supplied.':i.sealMatches?'Matches the assignment. Save the inspection.':'Mismatch: create an incident and hold the truck.'}`, i.sealMatches||i.flow==='register'?'review':'incident', [['submit',i.sealMatches||i.flow==='register'?'Save inspection':'Create incident']]);
    case 'issue_review': return result('Manual review required', 'The photograph could not establish a readable seal number. Create an incident for a supervisor; do not treat this as proof that the seal is absent.', 'incident', [['submit','Create review incident']]);
    case 'complete': return result('Inspection saved', i.flow==='register'?'Observed seal registered without a reference comparison. No release authorization.':'Seal matched. Trailer and photo recorded locally. This is not a release authorization.', 'complete', []);
    case 'incident': return result('HOLD · '+i.incident.title, `${pair}. Photo attached. Awaiting supervisor; no production notification sent.`, 'incident', []);
    default: return result('Unknown step', 'Refresh the demo service.', 'offline', []);
  }
}

export class SceneEvidence {
  constructor(world, api, accept, report) {
    Object.assign(this, {world, api, accept, report});
    this.attempts = new Set();
    this.pending = false;
  }
  async tick(state) {
    const i = state?.inspection;
    if (!i || i.step !== 'photo_pending' || !i.captureId || this.pending || this.attempts.has(i.captureId)) return;
    // Background tabs must not submit their unrelated viewpoint first.
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
    // One upload per capture request. Retake/retry always gets a new server ID.
    this.pending = true;
    this.attempts.add(i.captureId);
    if (this.attempts.size > 50) this.attempts.delete(this.attempts.values().next().value);
    try {
      this.world.setInspection(state);
      const image = this.world.captureView();
      const next = await this.api('inspection/upload', {
        revision: state.revision, inspectionVersion: i.version, captureId: i.captureId, image,
      });
      this.accept(next);
    } catch (e) { this.report(`Photo not saved: ${e.message}. Select Retry capture.`); }
    finally { this.pending = false; }
  }
}
