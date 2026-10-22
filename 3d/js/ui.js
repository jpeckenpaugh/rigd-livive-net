/**
 * Data-driven sidebar UI generator and DOM event bindings for the 3D rig.
 */

export class RigUI {
  constructor({ rig, spec, sequences, renderer }) {
    this.rig = rig;
    this.spec = spec;
    this.sequences = sequences || [];
    this.renderer = renderer;
    this.animator = null;

    this.controlBindings = [];
    this.bindingByStateKey = new Map();
    this.exploreChecks = [];
    this.hoveredSection = null;

    this.cardsContainer = document.getElementById('jointCardsContainer');
    this.sequenceSelect = document.getElementById('sequenceSelect');
    this.autoExploreBtn = document.getElementById('autoExploreBtn');
    this.resetBtn = document.getElementById('resetPoseBtn');
    this.modeSymBtn = document.getElementById('modeSymBtn');
    this.modeAntiBtn = document.getElementById('modeAntiBtn');
    this.toggleLabels = document.getElementById('toggleLabels');
    this.toggleJoints = document.getElementById('toggleJoints');
    this.toggleHeadMesh = document.getElementById('toggleHeadMesh');
  }

  init(animator) {
    this.animator = animator;
    this.buildSequenceDropdown();
    this.buildJointCards();
    this.bindHeaderControls();
    this.syncUI();
  }

  buildSequenceDropdown() {
    this.sequenceSelect.innerHTML = '<option value="">Select sequence…</option>';
    this.sequences.forEach(seq => {
      const opt = document.createElement('option');
      opt.value = seq.id;
      opt.textContent = seq.label;
      this.sequenceSelect.appendChild(opt);
    });
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
      if (!this.sequenceSelect.value) {
        this.animator.cancelSequence();
        return;
      }
      this.animator.startSequence(this.sequenceSelect.value);
    });

    this.resetBtn.addEventListener('click', () => {
      if (!this.animator) return;
      this.animator.cancelSequence();
      this.animator.stopExplore();
      this.animator.setExploreMode('free');
      this.animator.startResetTween();
    });

    [this.toggleLabels, this.toggleJoints, this.toggleHeadMesh].forEach(el => {
      el.addEventListener('change', () => this.requestRender());
    });
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
    this.renderer.render({
      showLabels: this.toggleLabels.checked,
      showJoints: this.toggleJoints.checked,
      showHeadMesh: this.toggleHeadMesh.checked,
      highlightSection: this.hoveredSection
    });
  }
}
