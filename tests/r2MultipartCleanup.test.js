/**
 * Unit tests: R2 multipart cleanup — XML parser and 24h cutoff behaviour
 */
import { describe, it, expect } from 'vitest';
import { parseListMultipartUploadsResponse } from '../src/services/R2MultipartCleanup.js';

describe('R2MultipartCleanup', () => {
    describe('parseListMultipartUploadsResponse', () => {
        it('parses empty XML to empty array', () => {
            const xml = '<?xml version="1.0"?><ListMultipartUploadsResult></ListMultipartUploadsResult>';
            expect(parseListMultipartUploadsResponse(xml)).toEqual([]);
        });

        it('parses single Upload block', () => {
            const xml = `<?xml version="1.0"?>
<ListMultipartUploadsResult>
<Upload>
<Key>raw-uploads%2F123-video.mp4</Key>
<UploadId>abc-upload-id-123</UploadId>
<Initiated>2025-02-20T10:00:00.000Z</Initiated>
</Upload>
</ListMultipartUploadsResult>`;
            const result = parseListMultipartUploadsResponse(xml);
            expect(result).toHaveLength(1);
            expect(result[0].key).toBe('raw-uploads/123-video.mp4');
            expect(result[0].uploadId).toBe('abc-upload-id-123');
            expect(result[0].initiated).toBe('2025-02-20T10:00:00.000Z');
        });

        it('parses multiple Upload blocks', () => {
            const xml = `<?xml version="1.0"?>
<ListMultipartUploadsResult>
<Upload><Key>a</Key><UploadId>id1</UploadId><Initiated>2025-01-01T00:00:00Z</Initiated></Upload>
<Upload><Key>b</Key><UploadId>id2</UploadId><Initiated>2025-01-02T00:00:00Z</Initiated></Upload>
</ListMultipartUploadsResult>`;
            const result = parseListMultipartUploadsResponse(xml);
            expect(result).toHaveLength(2);
            expect(result[0].key).toBe('a');
            expect(result[1].key).toBe('b');
        });

        it('skips Upload block when Key is missing', () => {
            const xml = `<Upload><UploadId>id1</UploadId><Initiated>2025-01-01T00:00:00Z</Initiated></Upload>`;
            expect(parseListMultipartUploadsResponse(xml)).toHaveLength(0);
        });
    });
});
