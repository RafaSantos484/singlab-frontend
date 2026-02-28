'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  Fab,
  Stack,
  IconButton,
  Tooltip,
  TextField,
  Select,
  MenuItem,
  InputAdornment,
  FormControl,
  InputLabel,
  Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

import { GlobalPlayer } from '@/components/features/GlobalPlayer';
import { SongCreateDialog } from '@/components/features/SongCreateDialog';
import { SongEditDialog } from '@/components/features/SongEditDialog';
import { SongDeleteButton } from '@/components/features/SongDeleteButton';
// useAuthGuard ensures user is authenticated before rendering the page
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
// useGlobalState provides access to user profile and songs list via Firestore
import { useGlobalState } from '@/lib/store';
import { useGlobalStateDispatch } from '@/lib/store/GlobalStateContext';
import { DashboardLayout } from '@/components/layout';
import type { Song } from '@/lib/api/types';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage(): React.ReactElement | null {
  const isLoading = useAuthGuard('private');
  const { userProfile, songs, songsStatus, currentSongId } = useGlobalState();
  const dispatch = useGlobalStateDispatch();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch by only rendering after client mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Client-side filtering and sorting
  // This memo computes the final list of songs to display, with three steps:
  // 1. Filter by search query (title/author) but always keep the currently playing song
  // 2. Sort by upload date (newest or oldest first)
  // 3. Pin the currently playing song to the top of the list for visibility
  const filteredAndSortedSongs = useMemo(() => {
    // Don't process until mounted to prevent hydration mismatch
    if (!mounted) return [];

    // Normalize search query for better matching
    const normalizedQuery = searchQuery.toLowerCase().trim();

    // Filter by title or author (always keep currently playing song)
    let filtered = songs;
    if (normalizedQuery) {
      filtered = songs.filter((song) => {
        // Always keep the currently playing song visible, even if it doesn't
        // match the search query. This ensures users can always see and control
        // what's playing regardless of active filters.
        if (song.id === currentSongId) return true;

        // Regular filter: match against title or author
        const titleMatch = song.title.toLowerCase().includes(normalizedQuery);
        const authorMatch = song.author.toLowerCase().includes(normalizedQuery);
        return titleMatch || authorMatch;
      });
    }

    // Sort by creation date (uploadedAt timestamp)
    const sorted = [...filtered].sort((a, b) => {
      const dateA = new Date(a.rawSongInfo.uploadedAt).getTime();
      const dateB = new Date(b.rawSongInfo.uploadedAt).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    // Pin currently playing song to the top of the sorted list
    // This provides a consistent "Now Playing" location at the top of the page.
    // Only move it if it's not already at index 0 (no-op if already first).
    if (currentSongId) {
      const playingIndex = sorted.findIndex((song) => song.id === currentSongId);
      if (playingIndex > 0) {
        const [playingSong] = sorted.splice(playingIndex, 1);
        sorted.unshift(playingSong);
      }
    }

    return sorted;
  }, [songs, searchQuery, sortOrder, currentSongId, mounted]);

  // Show loading state until component mounts on client (prevents hydration mismatch)
  if (!mounted || isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress size={32} />
      </Box>
    );
  }

  const user = userProfile;
  const displayName = user?.displayName ?? user?.email ?? 'User';

  return (
    <DashboardLayout>
      {/* Welcome card */}
      <Card
        sx={{
          mb: { xs: 4, sm: 5, lg: 6 },
          background:
            'linear-gradient(135deg, rgba(19, 10, 53, 0.6) 0%, rgba(13, 7, 38, 0.4) 100%)',
          border: '1px solid rgba(45, 26, 110, 0.4)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
              mb: 1,
            }}
          >
            Welcome back,
          </Typography>
          <Typography
            variant="h1"
            sx={{
              fontSize: { xs: '1.875rem', sm: '2.25rem', lg: '2.5rem' },
              fontWeight: 700,
              letterSpacing: '-0.02em',
              background: 'linear-gradient(to right, #ededed, #818cf8)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {displayName}
          </Typography>
        </CardContent>
      </Card>

      {/* Songs section */}
      <Box component="section">
        {/* Section header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 3,
          }}
        >
          <Typography
            variant="h5"
            sx={{
              fontWeight: 600,
              color: 'text.primary',
            }}
          >
            Your songs
          </Typography>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 500,
              color: 'text.disabled',
            }}
          >
            {songs.length} track{songs.length !== 1 ? 's' : ''}
          </Typography>
        </Box>

        {/* Search and sorting controls */}
        {songs.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              gap: 2,
              mb: 3,
            }}
          >
            {/* Search input */}
            <TextField
              placeholder="Search by title or author..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              fullWidth
              sx={{
                flex: 1,
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: 'text.disabled' }} />
                  </InputAdornment>
                ),
              }}
            />

            {/* Sort select */}
            <FormControl
              sx={{
                minWidth: { xs: '100%', sm: '200px' },
              }}
            >
              <InputLabel id="sort-order-label">Sort by</InputLabel>
              <Select
                labelId="sort-order-label"
                label="Sort by"
                value={sortOrder}
                onChange={(e) =>
                  setSortOrder(e.target.value as 'newest' | 'oldest')
                }
              >
                <MenuItem value="newest">Newest first</MenuItem>
                <MenuItem value="oldest">Oldest first</MenuItem>
              </Select>
            </FormControl>
          </Box>
        )}

        {/* Loading state */}
        {songsStatus === 'loading' && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              p: 2,
              borderRadius: 2,
              border: '1px solid rgba(45, 26, 110, 0.3)',
              bgcolor: 'rgba(10, 5, 32, 0.2)',
            }}
          >
            <CircularProgress size={16} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Loading songs…
            </Typography>
          </Box>
        )}

        {/* Error state */}
        {songsStatus === 'error' && (
          <Alert severity="error">
            Failed to load songs. Please refresh the page.
          </Alert>
        )}

        {/* Empty state */}
        {(songsStatus === 'ready' || songsStatus === 'idle') &&
          songs.length === 0 && (
            <Box
              sx={{
                p: 5,
                textAlign: 'center',
                borderRadius: 3,
                border: '2px dashed rgba(45, 26, 110, 0.3)',
                bgcolor: 'rgba(10, 5, 32, 0.2)',
              }}
            >
              <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                No songs yet. Upload your first track to get started.
              </Typography>
            </Box>
          )}

        {/* No search results */}
        {(songsStatus === 'ready' || songsStatus === 'idle') &&
          songs.length > 0 &&
          filteredAndSortedSongs.length === 0 && (
            <Box
              sx={{
                p: 5,
                textAlign: 'center',
                borderRadius: 3,
                border: '2px dashed rgba(45, 26, 110, 0.3)',
                bgcolor: 'rgba(10, 5, 32, 0.2)',
              }}
            >
              <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                No songs found matching &quot;{searchQuery}&quot;
              </Typography>
            </Box>
          )}

        {/* Songs grid */}
        {filteredAndSortedSongs.length > 0 && (
          <Stack spacing={{ xs: 2, md: 3 }}>
            {filteredAndSortedSongs.map((song) => (
              <Card
                key={song.id}
                sx={{
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    borderColor: 'rgba(124, 58, 237, 0.6)',
                    bgcolor: 'rgba(19, 10, 53, 0.7)',
                  },
                }}
              >
                <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
                  {/* Song metadata */}
                  <Box
                    sx={{
                      mb: 2,
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      justifyContent: 'space-between',
                      gap: 1,
                    }}
                  >
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      {/* Now Playing indicator */}
                      {song.id === currentSongId && (
                        <Chip
                          icon={<PlayCircleIcon />}
                          label="Now Playing"
                          size="small"
                          sx={{
                            mb: 1,
                            height: '24px',
                            bgcolor: 'rgba(124, 58, 237, 0.15)',
                            color: 'rgba(168, 85, 247, 1)',
                            borderColor: 'rgba(124, 58, 237, 0.4)',
                            border: '1px solid',
                            '& .MuiChip-icon': {
                              color: 'rgba(168, 85, 247, 1)',
                            },
                          }}
                        />
                      )}
                      <Typography
                        variant="body1"
                        sx={{
                          fontWeight: 600,
                          color: 'text.primary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {song.title}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          color: 'text.secondary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {song.author}
                      </Typography>
                    </Box>

                    {/* Action buttons */}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {/* Play button */}
                      <Tooltip title="Play song">
                        <IconButton
                          onClick={() =>
                            dispatch({
                              type: 'PLAYER_LOAD_SONG',
                              payload: song.id,
                            })
                          }
                          size="small"
                          sx={{
                            color: 'rgba(124, 58, 237, 0.8)',
                            bgcolor: 'rgba(124, 58, 237, 0.1)',
                            '&:hover': {
                              color: 'rgba(168, 85, 247, 1)',
                              bgcolor: 'rgba(124, 58, 237, 0.2)',
                            },
                          }}
                        >
                          <PlayArrowIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      {/* Edit button */}
                      <Tooltip title="Edit song">
                        <IconButton
                          onClick={() => setEditingSong(song)}
                          size="small"
                          sx={{
                            color: 'rgba(168, 85, 247, 0.8)',
                            '&:hover': {
                              color: 'rgba(168, 85, 247, 1)',
                              bgcolor: 'rgba(168, 85, 247, 0.1)',
                            },
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      {/* Delete button */}
                      <SongDeleteButton
                        songId={song.id}
                        songTitle={song.title}
                      />
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>

      {/* FAB button to create new song */}
      <Fab
        color="primary"
        aria-label="add song"
        onClick={() => setIsCreateDialogOpen(true)}
        sx={{
          position: 'fixed',
          bottom: { xs: 24, sm: 32 },
          right: { xs: 24, sm: 32 },
          background: 'linear-gradient(135deg, #a78bfa 0%, #c4b5fd 100%)',
          color: '#1a0e2e',
          '&:hover': {
            background: 'linear-gradient(135deg, #b8a3e0 0%, #d4c4ff 100%)',
            boxShadow: '0 8px 24px rgba(168, 85, 247, 0.4)',
          },
          '&:active': {
            boxShadow: '0 4px 12px rgba(168, 85, 247, 0.3)',
          },
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <AddIcon sx={{ fontSize: '1.75rem', fontWeight: 600 }} />
      </Fab>

      {/* Song creation modal */}
      <SongCreateDialog
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
      />

      {/* Song edit modal */}
      {editingSong && (
        <SongEditDialog
          open={!!editingSong}
          onClose={() => setEditingSong(null)}
          song={editingSong}
        />
      )}

      {/* Global audio player */}
      <GlobalPlayer />
    </DashboardLayout>
  );
}
