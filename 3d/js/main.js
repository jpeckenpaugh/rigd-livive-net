/**
 * Application entry point: loads JSON configs and wires Rig3D, RigRenderer, RigUI, and RigAnimator.
 */

import { Rig3D } from './rig.js';
import { RigRenderer } from './renderer.js';
import { RigUI } from './ui.js';
import { RigAnimator } from './animator.js';

async function bootstrap() {
  const [specRes, seqRes, kfRes] = await Promise.all([
    fetch('./data/rig-spec.json'),
    fetch('./data/sequences.json'),
    fetch('../data/asl/one/keyframes.json').catch(() => null)
  ]);

  if (!specRes.ok || !seqRes.ok) {
    throw new Error('Failed to load 3D rig configuration files.');
  }

  const [spec, seqData, keyframesData] = await Promise.all([
    specRes.json(),
    seqRes.json(),
    (kfRes && kfRes.ok) ? kfRes.json() : null
  ]);

  const canvas = document.getElementById('rigCanvas');
  const rig = new Rig3D(spec);
  const renderer = new RigRenderer(canvas, rig);
  const ui = new RigUI({
    rig,
    spec,
    sequences: seqData.sequences,
    renderer,
    keyframesData
  });
  const animator = new RigAnimator({
    rig,
    pairDefs: spec.symmetryPairs,
    sequences: seqData.sequences,
    ui
  });

  ui.init(animator);
  ui.requestRender();
}

bootstrap().catch(err => {
  console.error(err);
});
