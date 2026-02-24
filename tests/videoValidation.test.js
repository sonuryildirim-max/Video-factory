/**
 * Unit tests: SSRF / R2 key validator (validateR2Key)
 */
import { describe, it, expect } from 'vitest';
import { validateR2Key } from '../src/utils/videoValidation.js';
import { ValidationError } from '../src/utils/errors.js';

describe('validateR2Key', () => {
    it('accepts valid key with allowed prefix raw-uploads/', () => {
        expect(() => validateR2Key('raw-uploads/123-video.mp4', ['raw-uploads/'])).not.toThrow();
        expect(() => validateR2Key('raw-uploads/abc/def.mp4', ['raw-uploads/'])).not.toThrow();
    });

    it('accepts valid key with videos/ or thumbnails/', () => {
        expect(() => validateR2Key('videos/xyz.mp4', ['videos/', 'thumbnails/'])).not.toThrow();
        expect(() => validateR2Key('thumbnails/thumb-1.jpg', ['videos/', 'thumbnails/'])).not.toThrow();
    });

    it('throws on path traversal (..)', () => {
        expect(() => validateR2Key('raw-uploads/../etc/passwd', ['raw-uploads/'])).toThrow(ValidationError);
        expect(() => validateR2Key('raw-uploads/foo/../../bar', ['raw-uploads/'])).toThrow(ValidationError);
    });

    it('throws on invalid characters', () => {
        expect(() => validateR2Key('raw-uploads/<>file.mp4', ['raw-uploads/'])).toThrow(ValidationError);
        expect(() => validateR2Key('raw-uploads/file%.mp4', ['raw-uploads/'])).toThrow(ValidationError);
    });

    it('throws on empty or non-string key', () => {
        expect(() => validateR2Key('', ['raw-uploads/'])).toThrow(ValidationError);
        expect(() => validateR2Key('   ', ['raw-uploads/'])).toThrow(ValidationError);
    });

    it('throws when key does not start with allowed prefix', () => {
        expect(() => validateR2Key('other/key.mp4', ['raw-uploads/'])).toThrow(ValidationError);
    });

    it('throws when key is too long (>512)', () => {
        const long = 'raw-uploads/' + 'a'.repeat(520);
        expect(() => validateR2Key(long, ['raw-uploads/'])).toThrow(ValidationError);
    });
});
