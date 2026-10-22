/**
 * Animation controller for Auto Explore, Symmetry/Asymmetry pair tweens,
 * Reset Pose easing, and declarative preset sequences.
 */

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

export class RigAnimator {
  constructor({ rig, pairDefs, sequences, ui }) {
    this.rig = rig;
    this.pairDefs = pairDefs || [];
    this.sequencesById = new Map((sequences || []).map(seq => [seq.id, seq]));
    this.ui = ui;

    this.pairByKey = new Map();
    this.pairDefs.forEach(pair => {
      this.pairByKey.set(pair.left, pair);
      this.pairByKey.set(pair.right, pair);
    });

    this.exploring = false;
    this.exploreRAF = null;
    this.lastExploreTime = 0;
    this.exploreState = [];
    this.exploreMode = 'free';

    this.pairTween = null;
    this.resetTween = null;
    this.sequenceRAF = null;
    this.sequenceState = null;
  }

  getPairRelation(pair) {
    return this.exploreMode === 'sym' ? pair.sign : -pair.sign;
  }

  getLeaderRange(pair, relation, leaderKey) {
    const leader = this.ui.bindingByStateKey.get(leaderKey);
    const followerKey = leaderKey === pair.left ? pair.right : pair.left;
    const follower = this.ui.bindingByStateKey.get(followerKey);
    if (!leader || !follower) return [0, 0];
    if (pair.oneSided) return [leader.min, leader.max];

    const followerMin = relation > 0 ? follower.min : -follower.max;
    const followerMax = relation > 0 ? follower.max : -follower.min;

    return [
      Math.max(leader.min, followerMin),
      Math.min(leader.max, followerMax)
    ];
  }

  cancelPairTween() {
    if (this.pairTween && this.pairTween.raf !== null) {
      cancelAnimationFrame(this.pairTween.raf);
    }
    this.pairTween = null;
  }

  cancelResetTween() {
    if (this.resetTween && this.resetTween.raf !== null) {
      cancelAnimationFrame(this.resetTween.raf);
    }
    this.resetTween = null;
  }

  cancelSequence(clearSelection = true) {
    if (this.sequenceRAF !== null) {
      cancelAnimationFrame(this.sequenceRAF);
      this.sequenceRAF = null;
    }
    this.sequenceState = null;
    if (clearSelection) {
      this.ui.clearSequenceSelection();
    }
  }

  cancelAllForManualInput() {
    this.stopExplore();
    this.cancelPairTween();
    this.cancelResetTween();
    this.cancelSequence();
  }

  startResetTween() {
    if (this.exploring) return;
    this.cancelResetTween();
    this.cancelPairTween();

    const target = this.rig.getDefaultState();
    const entries = this.ui.controlBindings
      .map(binding => ({
        binding,
        from: this.rig.state[binding.stateKey],
        to: target[binding.stateKey] ?? this.rig.state[binding.stateKey]
      }))
      .filter(entry => Math.abs(entry.from - entry.to) > 0.001);

    if (entries.length === 0) {
      this.rig.reset();
      this.ui.syncUI();
      this.ui.requestRender();
      return;
    }

    this.resetTween = {
      startTime: performance.now(),
      duration: 1000,
      entries,
      raf: null
    };
    this.resetTween.raf = requestAnimationFrame(now => this.stepResetTween(now));
  }

  stepResetTween(now) {
    if (!this.resetTween) return;

    const progress = Math.min(1, (now - this.resetTween.startTime) / this.resetTween.duration);
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    this.resetTween.entries.forEach(entry => {
      this.ui.setControlValue(
        entry.binding.stateKey,
        entry.from + (entry.to - entry.from) * eased
      );
    });

    this.ui.requestRender();

    if (progress < 1) {
      this.resetTween.raf = requestAnimationFrame(t => this.stepResetTween(t));
    } else {
      this.resetTween = null;
      this.rig.reset();
      this.ui.syncUI();
      this.ui.requestRender();
    }
  }

  startPairTween() {
    if (this.exploreMode === 'free') return;
    this.cancelPairTween();

    const now = performance.now();
    const entries = [];

    this.pairDefs.forEach(pair => {
      const leftBinding = this.ui.bindingByStateKey.get(pair.left);
      const rightBinding = this.ui.bindingByStateKey.get(pair.right);
      if (!leftBinding || !rightBinding) return;

      const relation = this.getPairRelation(pair);
      const [min, max] = this.getLeaderRange(pair, relation, pair.left);
      const left = this.rig.state[pair.left];
      const right = this.rig.state[pair.right];
      const targetLeft = Math.max(min, Math.min(max, (left + relation * right) / 2));

      entries.push({
        leftKey: pair.left,
        rightKey: pair.right,
        startLeft: left,
        startRight: right,
        targetLeft,
        targetRight: relation * targetLeft
      });
    });

    const needsTween = entries.some(entry =>
      Math.abs(entry.startLeft - entry.targetLeft) > 0.01 ||
      Math.abs(entry.startRight - entry.targetRight) > 0.01
    );
    if (!needsTween) return;

    this.pairTween = { startTime: now, duration: 1000, entries, raf: null };
    this.pairTween.raf = requestAnimationFrame(t => this.stepPairTween(t));
  }

  stepPairTween(now) {
    if (!this.pairTween) return;

    const progress = Math.min(1, (now - this.pairTween.startTime) / this.pairTween.duration);
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    this.pairTween.entries.forEach(entry => {
      this.ui.setControlValue(
        entry.leftKey,
        entry.startLeft + (entry.targetLeft - entry.startLeft) * eased
      );
      this.ui.setControlValue(
        entry.rightKey,
        entry.startRight + (entry.targetRight - entry.startRight) * eased
      );
    });

    this.ui.requestRender();

    if (progress < 1) {
      this.pairTween.raf = requestAnimationFrame(t => this.stepPairTween(t));
    } else {
      this.pairTween = null;
    }
  }

  startSequence(name) {
    this.cancelSequence(false);

    const seq = this.sequencesById.get(name);
    if (!seq) {
      this.ui.clearSequenceSelection();
      return;
    }

    this.stopExplore();
    this.cancelPairTween();
    this.cancelResetTween();

    const startTime = performance.now();
    const duration = seq.duration || 1000;
    const trackStates = (seq.tracks || []).map(track => ({
      ...track,
      startValue: this.rig.state[track.stateKey] ?? 0
    }));

    this.sequenceState = { name };

    const step = (now) => {
      if (!this.sequenceState || this.sequenceState.name !== name) return;

      const progress = Math.min(1, (now - startTime) / duration);

      trackStates.forEach(track => {
        if (track.type === 'sine') {
          const blendWindow = track.blendIn || 0.05;
          const blendIn = Math.min(1, progress / blendWindow);
          const oscillation = track.amplitude * Math.sin(2 * Math.PI * track.cycles * progress);
          const val = track.startValue * (1 - blendIn) + oscillation * blendIn;
          this.ui.setControlValue(track.stateKey, val);
        }
      });

      this.ui.requestRender();

      if (progress < 1) {
        this.sequenceRAF = requestAnimationFrame(step);
      } else {
        trackStates.forEach(track => {
          if (typeof track.endValue === 'number') {
            this.ui.setControlValue(track.stateKey, track.endValue);
          }
        });
        this.ui.requestRender();
        this.sequenceRAF = null;
        this.sequenceState = null;
        this.ui.clearSequenceSelection();
      }
    };

    this.sequenceRAF = requestAnimationFrame(step);
  }

  setExploreMode(mode) {
    this.cancelSequence();
    this.cancelResetTween();
    this.exploreMode = mode;
    this.ui.updateExploreModeButtons(mode);

    if (mode === 'free') {
      this.cancelPairTween();
    } else {
      this.startPairTween();
    }
  }

  startExplore(checkAll = true) {
    if (this.exploring) return;
    this.cancelSequence();
    this.cancelResetTween();

    if (checkAll) {
      this.ui.setAllExploreChecks(true);
    }

    if (this.ui.getEnabledExploreSections().size === 0) return;

    this.exploring = true;
    this.ui.updateAutoExploreButton(true);

    if (this.exploreMode !== 'free' && !this.pairTween) {
      this.startPairTween();
    }

    const now = performance.now();
    this.exploreState = this.ui.controlBindings.map(binding => ({
      binding,
      target: randomBetween(binding.min, binding.max),
      nextChange: now + randomBetween(1200, 3800),
      speed: randomBetween(0.5, 1.2)
    }));

    this.lastExploreTime = now;
    this.exploreRAF = requestAnimationFrame(t => this.exploreStep(t));
  }

  stopExplore() {
    if (!this.exploring) return;

    this.exploring = false;
    if (this.exploreRAF !== null) {
      cancelAnimationFrame(this.exploreRAF);
      this.exploreRAF = null;
    }

    this.ui.setAllExploreChecks(false);
    this.ui.updateAutoExploreButton(false);
  }

  exploreStep(now) {
    if (!this.exploring) return;

    const dt = Math.min(0.05, Math.max(0, (now - this.lastExploreTime) / 1000));
    this.lastExploreTime = now;

    const enabledSections = this.ui.getEnabledExploreSections();
    if (enabledSections.size === 0) {
      this.stopExplore();
      return;
    }

    if (this.exploreMode !== 'free' && !this.pairTween) {
      this.pairDefs.forEach(pair => {
        const leftBinding = this.ui.bindingByStateKey.get(pair.left);
        const rightBinding = this.ui.bindingByStateKey.get(pair.right);
        if (!leftBinding || !rightBinding) return;

        const leftEnabled = enabledSections.has(leftBinding.sectionKey);
        const rightEnabled = enabledSections.has(rightBinding.sectionKey);
        if (!leftEnabled && !rightEnabled) return;

        const leaderKey = leftEnabled ? pair.left : pair.right;
        const followerKey = leaderKey === pair.left ? pair.right : pair.left;
        const relation = this.getPairRelation(pair);
        const [min, max] = this.getLeaderRange(pair, relation, leaderKey);
        const item = this.exploreState.find(entry => entry.binding.stateKey === leaderKey);
        if (!item) return;

        if (now >= item.nextChange) {
          item.target = randomBetween(min, max);
          item.nextChange = now + randomBetween(1500, 4200);
          item.speed = randomBetween(0.5, 1.2);
        } else if (item.target < min || item.target > max) {
          item.target = randomBetween(min, max);
        }

        const current = this.rig.state[leaderKey];
        let next = current + (item.target - current) * (1 - Math.exp(-dt * item.speed));
        next = Math.max(min, Math.min(max, next));

        this.ui.setControlValue(leaderKey, next);
        this.ui.setControlValue(followerKey, relation * next);
      });
    }

    this.exploreState.forEach(item => {
      const { binding } = item;
      if (!enabledSections.has(binding.sectionKey)) return;
      if (this.exploreMode !== 'free' && this.pairByKey.has(binding.stateKey)) return;

      if (now >= item.nextChange) {
        item.target = randomBetween(binding.min, binding.max);
        item.nextChange = now + randomBetween(1500, 4200);
        item.speed = randomBetween(0.5, 1.2);
      }

      const current = this.rig.state[binding.stateKey];
      const next = current + (item.target - current) * (1 - Math.exp(-dt * item.speed));
      this.ui.setControlValue(binding.stateKey, next);
    });

    this.ui.requestRender();
    this.exploreRAF = requestAnimationFrame(t => this.exploreStep(t));
  }
}
