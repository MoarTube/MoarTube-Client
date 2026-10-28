import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listedNames, missingFeatures } from '../scripts/verify-features.mjs';

test('reads format aliases and codec/filter flags without treating descriptions as features', () => {
  assert.deepEqual(
    [...listedNames(' D  mov,mp4,m4a QuickTime / MOV\n', 'demuxers')],
    ['mov', 'mp4', 'm4a']
  );
  assert.deepEqual([...listedNames(' V....D libx264 H.264 encoder\n', 'encoders')], ['libx264']);
  assert.deepEqual(
    [...listedNames(' V....D libvpx-vp9 VP9 encoder\n', 'encoders')],
    ['libvpx-vp9']
  );
  assert.deepEqual([...listedNames(' ... vpp_amf V->V AMF scaler\n', 'filters')], ['vpp_amf']);
  assert.deepEqual(
    [...listedNames('Filters:\n ... scale V->V vpp_amf is missing\n', 'filters')],
    ['scale']
  );
});

test('checks input and output protocol directions independently', () => {
  const protocols = 'Supported file protocols:\nInput:\n  file\n  rtmp\nOutput:\n  file\n';
  assert.deepEqual(
    missingFeatures(
      { inputProtocols: ['rtmp'], outputProtocols: ['rtmp'] },
      { inputProtocols: protocols, outputProtocols: protocols }
    ),
    ['outputProtocols: rtmp']
  );
});

test('missing reports and missing hardware filters fail closed', () => {
  assert.deepEqual(
    missingFeatures(
      { filters: ['scale', 'vpp_amf'], hwaccels: ['qsv'] },
      { filters: ' ... scale V->V software scaler\n' }
    ),
    ['filters: vpp_amf', 'hwaccels: qsv']
  );
});

test('reads hardware accelerators and bitstream filters', () => {
  assert.deepEqual(
    missingFeatures(
      { hwaccels: ['cuda', 'qsv'], bsfs: ['h264_mp4toannexb'] },
      {
        hwaccels: 'Hardware acceleration methods:\ncuda\nqsv\n',
        bsfs: 'Bitstream filters:\nh264_mp4toannexb\n',
      }
    ),
    []
  );
});
