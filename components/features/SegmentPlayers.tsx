'use client';

import React from 'react';
import { Box, Collapse, Typography } from '@mui/material';
import type { SpeechSegment } from '@/lib/audio/ffmpegVocals';

interface Props {
  speechSegments: SpeechSegment[];
  segmentUrls: Record<number, string>;
  processedAudioUrl: string | null;
  show: boolean;
  t: (key: string, params?: Record<string, unknown>) => string;
}

export function SegmentPlayers({ speechSegments, segmentUrls, processedAudioUrl, show, t }: Props): React.ReactElement {
  return (
    <>
      <Collapse in={show}>
        <Box sx={{ maxHeight: 260, overflowY: 'auto', pr: 1 }}>
          {speechSegments.length > 0 ? (
            speechSegments.map((seg, i) => {
              const src = segmentUrls[i] ?? processedAudioUrl ?? undefined;
              const duration = seg.processedEnd !== null && seg.processedStart !== null
                ? (seg.processedEnd - seg.processedStart)
                : null;
              return (
                <Box key={`seg-player-${i}`} sx={{ mb: 1 }}>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', display: 'block' }}>
                    {t('segmentLabel', { index: i + 1 })} — {t('timestampProcessedLabel')}: {formatTimestamp(seg.processedStart)} — {formatTimestamp(seg.processedEnd)}
                  </Typography>
                  {duration !== null && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {t('segmentDurationLabel', { duration: duration.toFixed(2) })}
                    </Typography>
                  )}
                  <Box
                    component="audio"
                    controls
                    src={src}
                    aria-label={t('segmentPlayerAriaLabel', { index: i + 1 })}
                    sx={{ width: '100%', display: 'block' }}
                  />
                </Box>
              );
            })
          ) : (
            <Box component="audio" controls src={processedAudioUrl ?? undefined} sx={{ width: '100%', display: 'block' }} />
          )}
        </Box>
      </Collapse>
    </>
  );
}

function formatTimestamp(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) {
    return '--:--.--';
  }
  const totalSeconds = Math.max(0, seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remaining = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remaining
    .toFixed(2)
    .padStart(5, '0')}`;
}
