/**
 * Portal File Upload Handler — manages drag-and-drop, file validation,
 * and presigned URL upload flow for ticket attachments.
 * Depends on: PortalValidation (validateFileType, validateFileSize), PortalAPI (requestUploadUrl)
 */
const PortalFileUpload = (() => {
  let files = [];
  let idCounter = 0;
  let onChangeCallback = null;

  /**
   * Generate a unique ID for each selected file.
   */
  function generateId() {
    idCounter += 1;
    return `file-${Date.now()}-${idCounter}`;
  }

  /**
   * Register a callback that fires after files are added or validation fails.
   * Callback receives (result) where result is the validation result object.
   */
  function onChange(cb) {
    onChangeCallback = cb;
  }

  function notifyChange(result) {
    if (typeof onChangeCallback === 'function') {
      onChangeCallback(result);
    }
  }

  /**
   * Set up drag-and-drop events on the drop zone element and wire the file input.
   * On drop or file selection, calls addFile for each file.
   */
  function initDropZone(dropZoneEl, fileInputEl) {
    dropZoneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZoneEl.classList.add('drag-over');
    });

    dropZoneEl.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZoneEl.classList.remove('drag-over');
    });

    dropZoneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZoneEl.classList.remove('drag-over');
      const droppedFiles = e.dataTransfer && e.dataTransfer.files;
      if (droppedFiles) {
        for (let i = 0; i < droppedFiles.length; i++) {
          addFile(droppedFiles[i]);
        }
      }
    });

    dropZoneEl.addEventListener('click', () => {
      fileInputEl.click();
    });

    fileInputEl.addEventListener('change', () => {
      const selected = fileInputEl.files;
      if (selected) {
        for (let i = 0; i < selected.length; i++) {
          addFile(selected[i]);
        }
      }
      fileInputEl.value = '';
    });
  }

  /**
   * Validate and add a file to the internal files array.
   * Returns a ValidationResult indicating success or the validation error.
   */
  function addFile(file) {
    const typeResult = PortalValidation.validateFileType(file.type);
    if (!typeResult.valid) {
      notifyChange(typeResult);
      return typeResult;
    }

    const sizeResult = PortalValidation.validateFileSize(file.type, file.size);
    if (!sizeResult.valid) {
      notifyChange(sizeResult);
      return sizeResult;
    }

    files.push({ file, id: generateId() });
    const result = { valid: true };
    notifyChange(result);
    return result;
  }

  /**
   * Remove a file at the given index from the internal array.
   */
  function removeFile(index) {
    if (index >= 0 && index < files.length) {
      files.splice(index, 1);
    }
  }

  /**
   * Return a shallow copy of the internal files array.
   */
  function getFiles() {
    return files.slice();
  }

  /**
   * Upload all pending files for the given ticket using the presigned URL flow.
   * For each file: request a presigned URL from the API, then PUT the file to S3.
   * Returns an array of UploadResult objects.
   */
  async function uploadAll(ticketId) {
    const results = [];

    for (const entry of files) {
      const { file } = entry;
      try {
        const urlResponse = await PortalAPI.requestUploadUrl(
          ticketId,
          file.name,
          file.type,
          file.size
        );

        const uploadRes = await fetch(urlResponse.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });

        if (!uploadRes.ok) {
          results.push({
            fileName: file.name,
            success: false,
            error: `Upload failed with status ${uploadRes.status}`,
          });
        } else {
          results.push({
            fileName: file.name,
            success: true,
            attachmentId: urlResponse.attachmentId,
          });
        }
      } catch (err) {
        results.push({
          fileName: file.name,
          success: false,
          error: err.message || 'Upload failed',
        });
      }
    }

    return results;
  }

  /**
   * Clear all pending files.
   */
  function reset() {
    files = [];
  }

  return {
    initDropZone,
    addFile,
    removeFile,
    getFiles,
    uploadAll,
    reset,
    onChange,
  };
})();
