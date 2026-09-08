/**
 * The rest of Print Options: the job's own details, and the share link.
 *
 * Both belong where the estimator is standing at delivery time. The details
 * (client, address, permit no., builder or occupant, due date) live on the
 * project — they are what Print with form prints under the project name — and
 * they are always optional: this panel is closed until it is opened, and a bid
 * is complete with none of it filled in.
 *
 * Rendered inside .print-options-content by js/views/manifest.js, which also
 * calls attachListeners(). Fields write straight to TakeoffState on input, so
 * nothing here re-renders the manifest while the estimator is typing.
 */

const TakeoffPrintPanel = (function () {
  const escapeHtml = TakeoffUtils.escapeHtml;

  const FIELDS = [
    { key: 'client', label: 'Client' },
    { key: 'address', label: 'Address' },
    { key: 'permitNo', label: 'Permit no.' },
    { key: 'builderOrOccupant', label: 'Builder or occupant' },
    { key: 'dueDate', label: 'Due date' },
  ];

  // Survives TakeoffApp.render() the way the purchase list's own flag does.
  let detailsOpen = false;

  function summaryText(details) {
    const filled = FIELDS.filter((f) => details[f.key]);
    if (!filled.length) return 'Client, address, permit — printed on the form';
    return filled.map((f) => details[f.key]).join(' · ');
  }

  function render() {
    const details = TakeoffState.getProjectDetails();
    const fields = FIELDS.map(
      (f) => `
        <label class="job-details-field">
          <span>${escapeHtml(f.label)}</span>
          <input type="text" data-detail="${f.key}" value="${escapeHtml(details[f.key] || '')}" />
        </label>`
    ).join('');

    return `
      <div class="print-panel">
        <button type="button" class="btn btn-secondary" id="copy-share-link-btn" title="Copy a link that opens a read-and-edit copy of this bid on another device">Copy share link</button>
        <div class="job-details ${detailsOpen ? 'expanded' : ''}">
          <button type="button" class="job-details-toggle" id="job-details-toggle" aria-expanded="${detailsOpen}">
            <span class="job-details-title">Job details</span>
            <span class="job-details-summary">${escapeHtml(summaryText(details))}</span>
          </button>
          <div class="job-details-fields" ${detailsOpen ? '' : 'hidden'}>${fields}</div>
        </div>
      </div>`;
  }

  function attachListeners() {
    document.getElementById('job-details-toggle')?.addEventListener('click', () => {
      detailsOpen = !detailsOpen;
      const wrap = document.querySelector('.print-panel .job-details');
      const fields = document.querySelector('.print-panel .job-details-fields');
      wrap?.classList.toggle('expanded', detailsOpen);
      document.getElementById('job-details-toggle')?.setAttribute('aria-expanded', String(detailsOpen));
      if (fields) fields.hidden = !detailsOpen;
      if (detailsOpen) fields?.querySelector('input')?.focus();
    });

    document.querySelectorAll('.print-panel input[data-detail]').forEach((input) => {
      input.addEventListener('input', () => {
        TakeoffState.setProjectDetails({ [input.dataset.detail]: input.value });
        const summary = document.querySelector('.print-panel .job-details-summary');
        if (summary) summary.textContent = summaryText(TakeoffState.getProjectDetails());
      });
    });

    // copyShareLink says how it went in the one feedback region (js/toast.js);
    // the button no longer rewrites its own label to say the same thing twice.
    document.getElementById('copy-share-link-btn')?.addEventListener('click', () => {
      TakeoffApp.copyShareLink();
    });
  }

  return { render, attachListeners };
})();
