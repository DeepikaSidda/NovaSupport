/**
 * Portal form validation — client-side validation for the ticket submission form.
 * Validates subject, description, file type, and file size.
 */
const PortalValidation = (() => {
  const ALLOWED_TYPES = {
    image: { types: ['image/png', 'image/jpeg', 'image/gif'], maxSize: 5 * 1024 * 1024 },
    document: { types: ['application/pdf', 'text/plain', 'text/log', 'application/x-log'], maxSize: 10 * 1024 * 1024 },
    video: { types: ['video/mp4', 'video/webm'], maxSize: 50 * 1024 * 1024 },
    audio: { types: ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg'], maxSize: 5 * 1024 * 1024 },
  };

  function validateSubject(value) {
    if (!value || !value.trim()) {
      return { valid: false, error: 'Subject is required' };
    }
    return { valid: true };
  }

  function validateDescription(value) {
    if (!value || !value.trim()) {
      return { valid: false, error: 'Description is required' };
    }
    return { valid: true };
  }

  function validateForm(subject, description) {
    const subjectResult = validateSubject(subject);
    const descriptionResult = validateDescription(description);
    const errors = {};

    if (!subjectResult.valid) {
      errors.subject = subjectResult.error;
    }
    if (!descriptionResult.valid) {
      errors.description = descriptionResult.error;
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  }

  function getCategoryForType(mimeType) {
    for (const [category, config] of Object.entries(ALLOWED_TYPES)) {
      if (config.types.includes(mimeType)) {
        return category;
      }
    }
    return null;
  }

  function validateFileType(mimeType) {
    const category = getCategoryForType(mimeType);
    if (category) {
      return { valid: true };
    }
    return {
      valid: false,
      error: 'Unsupported file type. Allowed: images (PNG, JPEG, GIF), documents (PDF, TXT), videos (MP4, WebM), audio (MP3, WAV, WebM, OGG)',
    };
  }

  const VALID_PRIORITIES = [1, 5, 8, 10];

  function validateEditForm(subject, description, priority) {
    const subjectResult = validateSubject(subject);
    const descriptionResult = validateDescription(description);
    const errors = {};

    if (!subjectResult.valid) {
      errors.subject = subjectResult.error;
    }
    if (!descriptionResult.valid) {
      errors.description = descriptionResult.error;
    }
    if (!VALID_PRIORITIES.includes(priority)) {
      errors.priority = 'Priority must be one of: Low, Medium, High, Critical';
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  }

  function validateMessage(content) {
    if (!content || !content.trim()) {
      return { valid: false, error: 'Message content is required' };
    }
    return { valid: true };
  }

  function validateFileSize(mimeType, size) {
    const category = getCategoryForType(mimeType);
    if (!category) {
      return { valid: false, error: 'Unsupported file type' };
    }
    const maxSize = ALLOWED_TYPES[category].maxSize;
    if (size > maxSize) {
      const maxMB = maxSize / (1024 * 1024);
      return {
        valid: false,
        error: `File exceeds maximum size of ${maxMB} MB for ${category} files`,
      };
    }
    return { valid: true };
  }

  return {
    ALLOWED_TYPES,
    validateSubject,
    validateDescription,
    validateForm,
    validateEditForm,
    validateMessage,
    validateFileType,
    validateFileSize,
  };
})();
