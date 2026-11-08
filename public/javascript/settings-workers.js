/* global $, Swal */
class MoarTubeWorkerSettings {
  constructor(showAlert = () => {}) {
    this.showAlert = showAlert;
    this.select = $('#worker-count-select');
    this.button = $('#worker-count-save');
    this.status = $('#worker-count-status');
    this.pending = false;
  }

  setStatus(message) {
    this.status.text(message).prop('hidden', !message);
  }

  async refresh() {
    const state = await $.ajax({ url: '/settings/node/workers', cache: false, timeout: 35000 });
    if (
      state.isError ||
      !Number.isInteger(state.maxWorkers) ||
      !Number.isInteger(state.runningWorkers)
    ) {
      throw new Error(state.message || 'Unable to read worker counts.');
    }
    this.state = state;
    this.select
      .empty()
      .append($('<option>').val(0).text(`Automatic (${state.maxWorkers} workers)`));
    for (let count = 1; count <= state.maxWorkers; count++) {
      this.select.append($('<option>').val(count).text(String(count)));
    }
    this.select.val(state.workerCount > state.maxWorkers ? state.maxWorkers : state.workerCount);
    this.setStatus('');
  }

  async start() {
    $('#worker-count-form').on('submit', (event) => {
      event.preventDefault();
      void this.apply();
    });
    try {
      await this.refresh();
      this.select.prop('disabled', false);
      this.button.prop('disabled', false);
    } catch (error) {
      this.setStatus(
        error.responseJSON?.message ||
          error.message ||
          'Unable to load worker counts. Reload settings to retry.',
      );
    }
  }

  async apply() {
    if (this.pending || !this.state) return;
    const workerCount = Number(this.select.val());
    this.pending = true;
    this.select.prop('disabled', true);
    this.button.prop('disabled', true);
    try {
      // Refresh immediately before confirmation; the primary independently rechecks the count.
      const latest = await $.ajax({ url: '/settings/node/workers', cache: false, timeout: 35000 });
      if (latest.isError) throw new Error(latest.message);
      const decrease =
        (workerCount === 0 ? latest.maxWorkers : Math.min(workerCount, latest.maxWorkers)) < latest.runningWorkers;
      let confirmDecrease = false;
      if (decrease) {
        const answer = await Swal.fire({
          icon: 'warning',
          title: 'Lower worker count?',
          text: 'Lowering the worker count may interrupt requests, playback, and connections. Active imports, publishing jobs, uploads, or live streams will prevent this change.',
          showCancelButton: true,
          confirmButtonText: 'Lower worker count',
          cancelButtonText: 'Cancel',
        });
        if (!answer.isConfirmed) return;
        confirmDecrease = true;
      }
      this.setStatus('Applying worker count…');
      const result = await $.ajax({
        type: 'POST',
        url: '/settings/node/workers',
        data: JSON.stringify({ workerCount, confirmDecrease }),
        contentType: 'application/json; charset=utf-8',
        timeout: 35000,
      });
      if (result.isError) throw new Error(result.message);
      await this.refresh();
      this.setStatus('');
      this.showAlert(false);
    } catch (error) {
      const message =
        error.responseJSON?.message ||
        error.message ||
        'Unable to apply worker count. Refresh settings to check the current count.';
      try {
        await this.refresh();
      } catch (_) {
        /* Keep the operation error visible. */
      }
      this.setStatus('');
      this.showAlert(true, message);
    } finally {
      this.pending = false;
      this.select.prop('disabled', false);
      this.button.prop('disabled', false);
    }
  }
}
