/**
 * Unit tests: SSRF / URL validation rules (validateR2Key and URL safety)
 */
import { describe, it, expect } from 'vitest';
import { validateR2Key } from '../src/utils/videoValidation.js';
import { ValidationError } from '../src/utils/errors.js';

describe('SSRF URL / R2 key validation', () => {
    describe('validateR2Key', () => {
        it('rejects path traversal (..) to prevent SSRF', () => {
            expect(() => validateR2Key('raw-uploads/../etc/passwd', ['raw-uploads/'])).toThrow(ValidationError);
            expect(() => validateR2Key('videos/../../other/key.mp4', ['videos/'])).toThrow(ValidationError);
        });

        it('rejects non-allowed prefixes', () => {
            expect(() => validateR2Key('https://evil.com/foo', ['raw-uploads/'])).toThrow(ValidationError);
            expect(() => validateR2Key('other/key.mp4', ['raw-uploads/'])).toThrow(ValidationError);
        });

        it('accepts valid keys under allowed prefix', () => {
            expect(() => validateR2Key('raw-uploads/abc-123.mp4', ['raw-uploads/'])).not.toThrow();
            expect(() => validateR2Key('videos/normalized-name.mp4', ['videos/', 'thumbnails/'])).not.toThrow();
        });

        it('rejects empty or whitespace', () => {
            expect(() => validateR2Key('', ['raw-uploads/'])).toThrow(ValidationError);
            expect(() => validateR2Key('   ', ['raw-uploads/'])).toThrow(ValidationError);
        });

        it('rejects invalid characters', () => {
            expect(() => validateR2Key('raw-uploads/<script>', ['raw-uploads/'])).toThrow(ValidationError);
            expect(() => validateR2Key('raw-uploads/file%.mp4', ['raw-uploads/'])).toThrow(ValidationError);
        });
    });
});
