import * as fs from 'fs';
import * as path from 'path';

const scriptPath = path.join(__dirname, '..', 'user-portal', 'portal-validation.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
const loadScript = new Function(scriptContent + '\nreturn PortalValidation;');
const PortalValidation = loadScript();

describe('PortalValidation - validateEditForm', () => {
  it('returns valid when all fields are correct', () => {
    const result = PortalValidation.validateEditForm('Bug report', 'App crashes', 5);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('accepts all valid priority values', () => {
    for (const p of [1, 5, 8, 10]) {
      const result = PortalValidation.validateEditForm('Subject', 'Description', p);
      expect(result.valid).toBe(true);
    }
  });

  it('rejects empty subject', () => {
    const result = PortalValidation.validateEditForm('', 'Description', 5);
    expect(result.valid).toBe(false);
    expect(result.errors.subject).toBe('Subject is required');
    expect(result.errors.description).toBeUndefined();
    expect(result.errors.priority).toBeUndefined();
  });

  it('rejects whitespace-only subject', () => {
    const result = PortalValidation.validateEditForm('  \t  ', 'Description', 1);
    expect(result.valid).toBe(false);
    expect(result.errors.subject).toBe('Subject is required');
  });

  it('rejects empty description', () => {
    const result = PortalValidation.validateEditForm('Subject', '', 8);
    expect(result.valid).toBe(false);
    expect(result.errors.description).toBe('Description is required');
    expect(result.errors.subject).toBeUndefined();
  });

  it('rejects invalid priority', () => {
    const result = PortalValidation.validateEditForm('Subject', 'Description', 3);
    expect(result.valid).toBe(false);
    expect(result.errors.priority).toBe('Priority must be one of: Low, Medium, High, Critical');
  });

  it('rejects string priority', () => {
    const result = PortalValidation.validateEditForm('Subject', 'Description', 'high');
    expect(result.valid).toBe(false);
    expect(result.errors.priority).toBe('Priority must be one of: Low, Medium, High, Critical');
  });

  it('collects all errors when all fields are invalid', () => {
    const result = PortalValidation.validateEditForm('', '', 99);
    expect(result.valid).toBe(false);
    expect(result.errors.subject).toBe('Subject is required');
    expect(result.errors.description).toBe('Description is required');
    expect(result.errors.priority).toBe('Priority must be one of: Low, Medium, High, Critical');
  });
});

describe('PortalValidation - validateMessage', () => {
  it('returns valid for non-empty content', () => {
    const result = PortalValidation.validateMessage('Please update the priority');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects empty string', () => {
    const result = PortalValidation.validateMessage('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Message content is required');
  });

  it('rejects whitespace-only string', () => {
    const result = PortalValidation.validateMessage('   \t\n  ');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Message content is required');
  });

  it('rejects null/undefined', () => {
    expect(PortalValidation.validateMessage(null).valid).toBe(false);
    expect(PortalValidation.validateMessage(undefined).valid).toBe(false);
  });
});
