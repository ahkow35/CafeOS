import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidOwnAttachmentUrl,
  isTrustedBlobUrl,
  attachmentContentType,
} from '../src/lib/storage';

const CAFE = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const HOST = 'https://abc123.public.blob.vercel-storage.com';

test('own medical-cert URL is accepted', () => {
  assert.equal(
    isValidOwnAttachmentUrl('medical-cert', `${HOST}/medical-certificates/${CAFE}/${USER}/1-mc-x.pdf`, CAFE, USER),
    true,
  );
});

test('own claim-receipt URL is accepted', () => {
  assert.equal(
    isValidOwnAttachmentUrl('claim-receipt', `${HOST}/claim-receipts/${CAFE}/${USER}/1-r-x.jpg`, CAFE, USER),
    true,
  );
});

test('kind prefixes do not cross', () => {
  assert.equal(
    isValidOwnAttachmentUrl('claim-receipt', `${HOST}/medical-certificates/${CAFE}/${USER}/1-mc-x.pdf`, CAFE, USER),
    false,
  );
});

test('another user path is rejected', () => {
  assert.equal(
    isValidOwnAttachmentUrl('claim-receipt', `${HOST}/claim-receipts/${CAFE}/other/1-r-x.jpg`, CAFE, USER),
    false,
  );
});

test('wrong host, http, and garbage are rejected', () => {
  assert.equal(isValidOwnAttachmentUrl('claim-receipt', `https://evil.com/claim-receipts/${CAFE}/${USER}/x.jpg`, CAFE, USER), false);
  assert.equal(isValidOwnAttachmentUrl('claim-receipt', `http://abc.public.blob.vercel-storage.com/claim-receipts/${CAFE}/${USER}/x.jpg`, CAFE, USER), false);
  assert.equal(isValidOwnAttachmentUrl('claim-receipt', 'not a url', CAFE, USER), false);
});

test('isTrustedBlobUrl only trusts https on the blob host', () => {
  assert.equal(isTrustedBlobUrl(`${HOST}/anything`), true);
  assert.equal(isTrustedBlobUrl('https://evil.com/x'), false);
  assert.equal(isTrustedBlobUrl('http://abc.public.blob.vercel-storage.com/x'), false);
});

test('content type derives from extension only', () => {
  assert.equal(attachmentContentType(`${HOST}/a/b.PDF?x=1`), 'application/pdf');
  assert.equal(attachmentContentType('x.jpeg'), 'image/jpeg');
  assert.equal(attachmentContentType('x.heic'), 'image/heic');
  assert.equal(attachmentContentType('x.exe'), 'application/octet-stream');
});
