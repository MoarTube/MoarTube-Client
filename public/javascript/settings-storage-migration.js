/* global $, Swal */
class MoarTubeStorageMigration {
    start() {
        $(document).off('click', '.trigger-storage-migrate').on('click', '.trigger-storage-migrate', () => this.open());
    }

    open() {
        const example = JSON.stringify({
            region: 'us-east-1',
            endpoint: 'https://s3.example.com',
            credentials: { accessKeyId: 'your-access-key', secretAccessKey: 'your-secret-key' }
        }, null, 2);
        const field = (name, label) => `<div id="migration-${name}-field" class="mb-3" hidden>
            <h3 class="fs-6 mb-3">${label} S3 store</h3>
            <div class="mb-2"><label class="form-label" for="migration-${name}-bucket">Bucket name</label>
                <input id="migration-${name}-bucket" class="form-control" type="text" placeholder="bucket name" autocomplete="off"></div>
            <div class="mb-2"><label class="form-label" for="migration-${name}">S3 client configuration (JSON)</label>
                <textarea id="migration-${name}" class="form-control" rows="9" spellcheck="false" autocomplete="off"></textarea></div>
            <label class="form-label" for="migration-${name}-url-format">URL format</label>
            <select id="migration-${name}-url-format" class="form-control">
                <option value="path" selected>path-style</option><option value="vhost">vhost-style</option>
            </select>
        </div>`;
        Swal.fire({
            title: 'Migrate Storage',
            width: '45rem',
            customClass: { popup: 'storage-migration-modal', confirmButton: 'btn bg-gradient-primary' },
            buttonsStyling: false,
            html: `<div class="storage-migration-content">
                <fieldset class="storage-migration-options"><legend>I want to migrate data from...</legend>
                    <label><input class="form-check-input" type="radio" name="storage-migration-direction" value="filesystem-to-s3"><span>From this node's file system to S3 store</span></label>
                    <label><input class="form-check-input" type="radio" name="storage-migration-direction" value="s3-to-s3"><span>From S3 store to another S3 store</span></label>
                    <label><input class="form-check-input" type="radio" name="storage-migration-direction" value="s3-to-filesystem"><span>From S3 store to this node's file system</span></label>
                </fieldset>
                ${field('source', 'Source')}
                <hr id="migration-config-divider" class="horizontal dark my-4" hidden>
                ${field('destination', 'Destination')}
                <div class="storage-migration-warning" role="note">
                    <strong>Warning: matching destination video data will be overwritten.</strong>
                    <p>There are no backups or rollback. Nothing is deleted: source data and destination-only data remain. You are responsible for preparing your data and stopping uploads, streams, and other changes if you need a consistent copy.</p>
                    <p>A failed migration can leave a partial copy and unfinished S3 multipart uploads. S3 read/write tests leave a Moartube-Client-Test object in each bucket. Storage mode is not changed automatically.</p>
                </div>
            </div>`,
            confirmButtonText: 'Migrate',
            showCloseButton: true,
            showLoaderOnConfirm: true,
            allowOutsideClick: () => !Swal.isLoading(),
            allowEscapeKey: () => !Swal.isLoading(),
            didOpen: () => {
                $('#migration-source, #migration-destination').attr('placeholder', example);
                $('input[name="storage-migration-direction"]').on('change', function () {
                    $('#migration-source-field').prop('hidden', this.value === 'filesystem-to-s3');
                    $('#migration-destination-field').prop('hidden', this.value === 's3-to-filesystem');
                    $('#migration-config-divider').prop('hidden', this.value !== 's3-to-s3');
                });
            },
            preConfirm: async () => {
                const direction = $('input[name="storage-migration-direction"]:checked').val();
                if (!direction) {
                    Swal.showValidationMessage('Select a migration option.');
                    return false;
                }
                const migration = { direction };
                try {
                    const configuration = (name) => {
                        const bucketName = $(`#migration-${name}-bucket`).val().trim();
                        if (!bucketName) throw new Error('Enter a bucket name for each S3 store.');
                        let provider;
                        try { provider = JSON.parse($(`#migration-${name}`).val()); }
                        catch { throw new Error('Enter valid JSON for each S3 client configuration.'); }
                        if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
                            throw new Error('Enter a JSON object for each S3 client configuration.');
                        }
                        return {
                            bucketName,
                            s3ProviderClientConfig: {
                                ...provider,
                                forcePathStyle: $(`#migration-${name}-url-format`).val() === 'path'
                            }
                        };
                    };
                    if (direction !== 'filesystem-to-s3') migration.source = configuration('source');
                    if (direction !== 's3-to-filesystem') migration.destination = configuration('destination');
                } catch (error) {
                    Swal.showValidationMessage(error.message);
                    return false;
                }
                try {
                    const result = await $.ajax({
                        type: 'POST', url: '/settings/node/storage/migrate',
                        data: JSON.stringify(migration), contentType: 'application/json; charset=utf-8', timeout: 0
                    });
                    if (result.isError) throw new Error(result.message || 'Migration failed. Destination data may be partially overwritten.');
                    return result;
                } catch (error) {
                    const message = error.responseJSON?.message || error.message || 'Migration could not be confirmed. Check the Node; destination data may be partially overwritten.';
                    // SweetAlert validation messages accept HTML; insert server messages as text.
                    Swal.showValidationMessage('Migration failed.');
                    $(Swal.getValidationMessage()).text(message);
                    return false;
                }
            }
        }).then((result) => {
            if (result.isConfirmed) Swal.fire({
                icon: 'success', title: 'Migration complete',
                text: `Copied ${result.value.filesCopied} files. Source data was retained. Storage mode has not changed.`
            });
        });
    }
}
