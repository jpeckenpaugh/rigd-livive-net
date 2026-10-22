/**
 * Data-driven sidebar UI generator and DOM event bindings for the 3D rig.
 */

export class RigUI {
  constructor({ rig, spec, sequences, renderer, keyframesData }) {
    this.rig = rig;
    this.spec = spec;
    this.sequences = sequences || [];
    this.renderer = renderer;
    this.keyframesData = keyframesData || null;
    this.animator = null;

    this.controlBindings = [];
    this.bindingByStateKey = new Map();
    this.exploreChecks = [];
    this.hoveredSection = null;

    this.currentKeyframeIndex = 0;
    this.currentSign = 'one';
    this.loadedKeyframeImages = new Map();
    this.cachedKeyframes = new Map();
    if (this.keyframesData) {
      this.cachedKeyframes.set('one', this.keyframesData);
    }

    this.cardsContainer = document.getElementById('jointCardsContainer');
    this.sequenceSelect = document.getElementById('sequenceSelect');
    this.autoExploreBtn = document.getElementById('autoExploreBtn');
    this.resetBtn = document.getElementById('resetPoseBtn');
    this.modeSymBtn = document.getElementById('modeSymBtn');
    this.modeAntiBtn = document.getElementById('modeAntiBtn');
    this.toggleLabels = document.getElementById('toggleLabels');
    this.toggleJoints = document.getElementById('toggleJoints');
    this.toggleHeadMesh = document.getElementById('toggleHeadMesh');
    this.toggleShadows = document.getElementById('toggleShadows');
    this.toggleKeyframeOverlay = document.getElementById('toggleKeyframeOverlay');

    this.keyframeCard = document.getElementById('keyframeReviewCard');
    this.kfSignSelect = document.getElementById('kfSignSelect');
    this.kfSlider = document.getElementById('kfSlider');
    this.kfPrevBtn = document.getElementById('kfPrevBtn');
    this.kfNextBtn = document.getElementById('kfNextBtn');
    this.kfFrameLabel = document.getElementById('kfFrameLabel');
    this.kfPhaseLabel = document.getElementById('kfPhaseLabel');
    this.keyframeScoreBadge = document.getElementById('keyframeScoreBadge');
  }

  init(animator) {
    this.animator = animator;
    this.buildSequenceDropdown();
    this.buildKeyframeSignDropdown();
    this.buildJointCards();
    this.bindHeaderControls();
    this.syncUI();
  }

  buildSequenceDropdown() {
    this.sequenceSelect.innerHTML = '<option value="">Select sequence…</option>';
    const sorted = [...this.sequences].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    );
    sorted.forEach(seq => {
      const opt = document.createElement('option');
      opt.value = seq.id;
      opt.textContent = seq.label;
      this.sequenceSelect.appendChild(opt);
    });
  }

  buildKeyframeSignDropdown() {
    if (!this.kfSignSelect) return;
    const aslSeqs = (this.sequences || [])
      .filter(s => s.id && s.id.startsWith('asl-'))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

    if (aslSeqs.length > 0) {
      const current = this.kfSignSelect.value || this.currentSign || 'one';
      this.kfSignSelect.innerHTML = '';
      aslSeqs.forEach(seq => {
        const sign = seq.id.replace('asl-', '');
        const opt = document.createElement('option');
        opt.value = sign;
        opt.textContent = seq.label;
        this.kfSignSelect.appendChild(opt);
      });
      if (aslSeqs.some(s => s.id.replace('asl-', '') === current)) {
        this.kfSignSelect.value = current;
      } else {
        this.kfSignSelect.value = aslSeqs[0].id.replace('asl-', '');
        this.currentSign = this.kfSignSelect.value;
      }
    }
  }

  buildJointCards() {
    this.cardsContainer.innerHTML = '';
    this.controlBindings = [];
    this.bindingByStateKey.clear();
    this.exploreChecks = [];

    this.spec.sections.forEach(section => {
      const card = document.createElement('div');
      card.className = 'joint-card';
      card.dataset.rigSection = section.id;

      const header = document.createElement('div');
      header.className = 'joint-header';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'joint-name';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'explore-check';
      checkbox.dataset.exploreKey = section.id;
      checkbox.setAttribute('aria-label', section.exploreLabel);
      checkbox.title = 'Include in Auto Explore';

      const dot = document.createElement('span');
      dot.style.color = section.dotColor;
      dot.textContent = '●';

      nameSpan.appendChild(checkbox);
      nameSpan.appendChild(dot);
      nameSpan.appendChild(document.createTextNode(` ${section.cardTitle}`));

      const tag = document.createElement('span');
      tag.className = `joint-tag ${section.tagClass}`;
      tag.textContent = section.tagLabel;

      header.appendChild(nameSpan);
      header.appendChild(tag);
      card.appendChild(header);

      const jointRef = this.rig.joints[section.jointId];

      section.controls.forEach(ctrl => {
        const unit = ctrl.unit || '°';
        const row = document.createElement('div');
        row.className = 'control-row';

        const labelDiv = document.createElement('div');
        labelDiv.className = 'control-label';

        const labelText = document.createElement('span');
        labelText.textContent = ctrl.label;
        if (ctrl.title) {
          labelText.title = ctrl.title;
        }

        const valDisplay = document.createElement('span');
        valDisplay.className = 'control-val';
        valDisplay.id = ctrl.valId;
        valDisplay.textContent = `${ctrl.default}${unit}`;

        labelDiv.appendChild(labelText);
        labelDiv.appendChild(valDisplay);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = ctrl.sliderId;
        slider.min = String(ctrl.min);
        slider.max = String(ctrl.max);
        slider.value = String(ctrl.default);

        row.appendChild(labelDiv);
        row.appendChild(slider);
        card.appendChild(row);

        slider.addEventListener('input', (e) => {
          if (this.animator) {
            this.animator.cancelAllForManualInput();
          }

          let val = parseFloat(e.target.value);
          if (jointRef && ctrl.paramName) {
            val = jointRef.clamp(ctrl.paramName, val);
            slider.value = val;
          }
          this.rig.state[ctrl.stateKey] = val;
          valDisplay.textContent = `${Math.round(val)}${unit}`;
          this.requestRender();
        });

        const binding = {
          slider,
          valDisplay,
          stateKey: ctrl.stateKey,
          jointRef,
          paramName: ctrl.paramName,
          unit,
          min: parseFloat(ctrl.min),
          max: parseFloat(ctrl.max),
          sectionKey: section.id
        };

        this.controlBindings.push(binding);
        this.bindingByStateKey.set(ctrl.stateKey, binding);
      });

      card.addEventListener('mouseenter', () => {
        this.hoveredSection = section.id;
        this.requestRender();
      });

      card.addEventListener('mouseleave', () => {
        if (this.hoveredSection === section.id) {
          this.hoveredSection = null;
          this.requestRender();
        }
      });

      checkbox.addEventListener('change', () => {
        if (!this.animator) return;
        const enabledCount = this.getEnabledExploreSections().size;
        if (this.animator.exploring) {
          if (enabledCount === 0) this.animator.stopExplore();
        } else if (enabledCount > 0) {
          this.animator.startExplore(false);
        }
      });

      this.exploreChecks.push(checkbox);
      this.cardsContainer.appendChild(card);
    });
  }

  bindHeaderControls() {
    this.autoExploreBtn.addEventListener('click', () => {
      if (!this.animator) return;
      if (this.animator.exploring) {
        this.animator.stopExplore();
      } else {
        this.animator.startExplore(true);
      }
    });

    this.modeSymBtn.addEventListener('click', () => {
      if (!this.animator) return;
      this.animator.setExploreMode(this.animator.exploreMode === 'sym' ? 'free' : 'sym');
    });

    this.modeAntiBtn.addEventListener('click', () => {
      if (!this.animator) return;
      this.animator.setExploreMode(this.animator.exploreMode === 'anti' ? 'free' : 'anti');
    });

    this.sequenceSelect.addEventListener('change', () => {
      if (!this.animator) return;
      const val = this.sequenceSelect.value;
      if (!val) {
        this.animator.cancelSequence();
        return;
      }
      if (val.startsWith('asl-')) {
        const sign = val.replace('asl-', '');
        if (this.kfSignSelect) this.kfSignSelect.value = sign;
        this.switchSign(sign, false);
      }
      this.animator.startSequence(val);
    });

    this.resetBtn.addEventListener('click', () => {
      if (!this.animator) return;
      this.animator.cancelSequence();
      this.animator.stopExplore();
      this.animator.setExploreMode('free');
      this.animator.startResetTween();
    });

    [this.toggleLabels, this.toggleJoints, this.toggleHeadMesh, this.toggleShadows].forEach(el => {
      if (el) el.addEventListener('change', () => this.requestRender());
    });

    if (this.kfSignSelect) {
      this.kfSignSelect.addEventListener('change', () => {
        this.switchSign(this.kfSignSelect.value, true);
      });
    }

    if (this.toggleKeyframeOverlay) {
      this.toggleKeyframeOverlay.addEventListener('change', () => {
        const active = this.toggleKeyframeOverlay.checked;
        if (this.keyframeCard) {
          this.keyframeCard.style.display = active ? 'block' : 'none';
        }
        if (active) {
          this.showKeyframe(this.currentKeyframeIndex);
        } else {
          this.requestRender();
        }
      });
    }

    if (this.kfSlider) {
      this.kfSlider.addEventListener('input', (e) => {
        this.showKeyframe(parseInt(e.target.value, 10));
      });
    }

    if (this.kfPrevBtn) {
      this.kfPrevBtn.addEventListener('click', () => {
        const prev = Math.max(0, this.currentKeyframeIndex - 1);
        if (this.kfSlider) this.kfSlider.value = prev;
        this.showKeyframe(prev);
      });
    }

    if (this.kfNextBtn) {
      this.kfNextBtn.addEventListener('click', () => {
        const total = (this.keyframesData && this.keyframesData.frames) ? this.keyframesData.frames.length : 17;
        const next = Math.min(total - 1, this.currentKeyframeIndex + 1);
        if (this.kfSlider) this.kfSlider.value = next;
        this.showKeyframe(next);
      });
    }
  }

  async switchSign(sign, autoShowFrame = true) {
    this.currentSign = sign;
    if (this.cachedKeyframes.has(sign)) {
      this.keyframesData = this.cachedKeyframes.get(sign);
    } else {
      try {
        const res = await fetch(`../data/asl/${sign}/keyframes.json`);
        if (res.ok) {
          this.keyframesData = await res.json();
          this.cachedKeyframes.set(sign, this.keyframesData);
        }
      } catch (err) {
        console.warn(`Could not load keyframes for ASL sign ${sign}:`, err);
        return;
      }
    }

    if (this.keyframesData && this.keyframesData.frames) {
      if (this.kfSlider) {
        this.kfSlider.max = this.keyframesData.frames.length - 1;
        this.kfSlider.value = 0;
      }
      this.currentKeyframeIndex = 0;
      if (autoShowFrame && this.toggleKeyframeOverlay && this.toggleKeyframeOverlay.checked) {
        this.showKeyframe(0);
      }
    }
  }

  showKeyframe(index) {
    if (!this.keyframesData || !this.keyframesData.frames) return;
    const frames = this.keyframesData.frames;
    if (index < 0 || index >= frames.length) return;

    this.currentKeyframeIndex = index;
    const f = frames[index];

    if (this.animator) {
      this.animator.cancelAllForManualInput();
    }

    // Apply the solved joint angles directly to the rig
    if (f.rig_state) {
      Object.entries(f.rig_state).forEach(([k, val]) => {
        this.setControlValue(k, val);
      });
    }

    if (this.kfFrameLabel) {
      this.kfFrameLabel.textContent = `Frame ${index + 1} / ${frames.length} (${f.timestamp_ms}ms)`;
    }
    if (this.kfPhaseLabel) {
      this.kfPhaseLabel.textContent = f.phase || 'pose';
    }
    if (this.keyframeScoreBadge) {
      const score = (f.reward && typeof f.reward.total_reward === 'number')
        ? f.reward.total_reward.toFixed(3)
        : '--';
      this.keyframeScoreBadge.textContent = `Score: ${score}`;
    }

    // Load or retrieve the reference image
    const sign = (this.keyframesData && this.keyframesData.sign) || this.currentSign || 'one';
    const imgUrl = `../data/asl/${sign}/${f.file}`;
    if (!this.loadedKeyframeImages.has(imgUrl)) {
      const img = new Image();
      img.src = imgUrl;
      img.onload = () => {
        this.loadedKeyframeImages.set(imgUrl, img);
        this.requestRender();
      };
    } else {
      this.requestRender();
    }
  }

  setControlValue(stateKey, value) {
    const binding = this.bindingByStateKey.get(stateKey);
    if (!binding) return;

    let next = value;
    if (binding.jointRef && binding.paramName) {
      next = binding.jointRef.clamp(binding.paramName, next);
    }

    this.rig.state[stateKey] = next;
    binding.slider.value = next;
    binding.valDisplay.textContent = `${Math.round(next)}${binding.unit}`;
  }

  syncUI() {
    this.controlBindings.forEach(binding => {
      const val = this.rig.state[binding.stateKey];
      binding.slider.value = val;
      binding.valDisplay.textContent = `${Math.round(val)}${binding.unit}`;
    });
  }

  getEnabledExploreSections() {
    return new Set(
      this.exploreChecks
        .filter(checkbox => checkbox.checked)
        .map(checkbox => checkbox.dataset.exploreKey)
    );
  }

  setAllExploreChecks(checked) {
    this.exploreChecks.forEach(checkbox => {
      checkbox.checked = checked;
    });
  }

  updateAutoExploreButton(exploring) {
    this.autoExploreBtn.textContent = exploring ? 'Stop Explore' : 'Auto Explore';
    this.autoExploreBtn.classList.toggle('is-active', exploring);
    this.autoExploreBtn.setAttribute('aria-pressed', exploring ? 'true' : 'false');
  }

  updateExploreModeButtons(mode) {
    this.modeSymBtn.classList.toggle('is-active', mode === 'sym');
    this.modeAntiBtn.classList.toggle('is-active', mode === 'anti');
    this.modeSymBtn.setAttribute('aria-pressed', mode === 'sym' ? 'true' : 'false');
    this.modeAntiBtn.setAttribute('aria-pressed', mode === 'anti' ? 'true' : 'false');
  }

  clearSequenceSelection() {
    this.sequenceSelect.value = '';
  }

  requestRender() {
    let keyframeImage = null;
    let keyframeCalib = null;
    const showKeyframeOverlay = !!(this.toggleKeyframeOverlay && this.toggleKeyframeOverlay.checked);
    if (showKeyframeOverlay && this.keyframesData && this.keyframesData.frames) {
      const f = this.keyframesData.frames[this.currentKeyframeIndex];
      keyframeCalib = this.keyframesData.calibration || null;
      if (f) {
        const sign = (this.keyframesData && this.keyframesData.sign) || this.currentSign || 'one';
        const imgUrl = `../data/asl/${sign}/${f.file}`;
        keyframeImage = this.loadedKeyframeImages.get(imgUrl) || null;
      }
    }

    this.renderer.render({
      showLabels: this.toggleLabels.checked,
      showJoints: this.toggleJoints.checked,
      showHeadMesh: this.toggleHeadMesh.checked,
      showShadows: this.toggleShadows ? this.toggleShadows.checked : true,
      showKeyframeOverlay,
      keyframeImage,
      keyframeCalib,
      highlightSection: this.hoveredSection
    });
  }
}
