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
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslations } from 'next-intl';

import { SongCreateDialog } from '@/components/features/SongCreateDialog';
import { SongEditDialog } from '@/components/features/SongEditDialog';
import { SongDeleteButton } from '@/components/features/SongDeleteButton';
import { SeparationDialog } from '@/components/features/SeparationDialog';
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { useGlobalState } from '@/lib/store';
import { useGlobalStateDispatch } from '@/lib/store/GlobalStateContext';
import { DashboardLayout } from '@/components/layout';
import type { SeparationStemName, Song } from '@/lib/api/types';
import { useSeparationStatus } from '@/lib/hooks/useSeparationStatus';
import { GlobalPlayer } from '@/components/features/GlobalPlayer';
import { deleteSeparatedSongInfo } from '@/lib/firebase/songs';
import { deleteSeparationStems } from '@/lib/storage/uploadSeparationStems';
import { getFirebaseAuth } from '@/lib/firebase/auth';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage(): React.ReactElement | null {
  const t = useTranslations('Dashboard');
  const isLoading = useAuthGuard('private');
  const { userProfile, songs, songsStatus, currentSongId } = useGlobalState();
  const dispatch = useGlobalStateDispatch();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const filteredAndSortedSongs = useMemo(() => {
    if (!mounted) return [];

    const normalizedQuery = searchQuery.toLowerCase().trim();

    let filtered = songs;
    if (normalizedQuery) {
      filtered = songs.filter((song) => {
        const titleMatch = song.title.toLowerCase().includes(normalizedQuery);
        const authorMatch = song.author.toLowerCase().includes(normalizedQuery);
        return titleMatch || authorMatch;
      });
    }

    const sorted = [...filtered].sort((a, b) => {
      const dateA = new Date(a.rawSongInfo.uploadedAt).getTime();
      const dateB = new Date(b.rawSongInfo.uploadedAt).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    return sorted;
  }, [songs, searchQuery, sortOrder, mounted]);

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
            {t('welcomeBack')}
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
            {t('yourSongs')}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 500,
              color: 'text.disabled',
            }}
          >
            {t('trackCount', { count: songs.length })}
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
            <TextField
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              fullWidth
              sx={{ flex: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: 'text.disabled' }} />
                  </InputAdornment>
                ),
              }}
            />

            <FormControl
              sx={{
                minWidth: { xs: '100%', sm: '200px' },
              }}
            >
              <InputLabel id="sort-order-label">{t('sortByLabel')}</InputLabel>
              <Select
                labelId="sort-order-label"
                label={t('sortByLabel')}
                value={sortOrder}
                onChange={(e) =>
                  setSortOrder(e.target.value as 'newest' | 'oldest')
                }
              >
                <MenuItem value="newest">{t('sortNewest')}</MenuItem>
                <MenuItem value="oldest">{t('sortOldest')}</MenuItem>
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
              {t('loadingSongs')}
            </Typography>
          </Box>
        )}

        {/* Error state */}
        {songsStatus === 'error' && (
          <Alert severity="error">{t('loadError')}</Alert>
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
                {t('emptyState')}
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
                {t('noSearchResults', { query: searchQuery })}
              </Typography>
            </Box>
          )}

        {/* Songs grid */}
        {filteredAndSortedSongs.length > 0 && (
          <Stack spacing={{ xs: 2, md: 3 }}>
            {filteredAndSortedSongs.map((song) => (
              <SongCardItem
                key={song.id}
                song={song}
                isCurrent={song.id === currentSongId}
                onPlay={() =>
                  dispatch({ type: 'PLAYER_LOAD_SONG', payload: song.id })
                }
                onEdit={() => setEditingSong(song)}
              />
            ))}
          </Stack>
        )}
      </Box>

      {/* FAB button to create new song */}
      <Fab
        color="primary"
        aria-label={t('addSongAriaLabel')}
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

      <SongCreateDialog
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
      />

      {editingSong && (
        <SongEditDialog
          open={!!editingSong}
          onClose={() => setEditingSong(null)}
          song={editingSong}
        />
      )}

      <GlobalPlayer />
    </DashboardLayout>
  );
}

// ---------------------------------------------------------------------------
// SongCardItem
// ---------------------------------------------------------------------------

interface SongCardItemProps {
  song: Song;
  isCurrent: boolean;
  onPlay: () => void;
  onEdit: () => void;
}

/**
 * Individual song card with metadata, playback controls, and separation status.
 */
function SongCardItem({
  song,
  isCurrent,
  onPlay,
  onEdit,
}: SongCardItemProps): React.ReactElement {
  const t = useTranslations('Dashboard');
  const tAll = useTranslations();
  const tSep = useTranslations('Separation');
  const tPlayer = useTranslations('Player');
  const { songsStemUploading } = useGlobalState();
  const [isSeparationDialogOpen, setIsSeparationDialogOpen] = useState(false);
  const [isDeleteStemsDialogOpen, setIsDeleteStemsDialogOpen] = useState(false);
  const [isDeletingStemsLoading, setIsDeletingStemsLoading] = useState(false);
  const [showSeparationSuccessSnackbar, setShowSeparationSuccessSnackbar] =
    useState(false);
  const [separationSuccessMessage, setSeparationSuccessMessage] = useState('');

  const {
    separation,
    isRefreshing,
    error: separationError,
    stemUrls,
    stemUrlError,
    refreshStatus,
  } = useSeparationStatus(song);

  const isProcessing = separation?.status === 'processing';
  const isFinished = separation?.status === 'finished';
  const isFailed = separation?.status === 'failed';
  const isUploadingStems = songsStemUploading.has(song.id);

  const availableStems = isFinished
    ? Object.entries(stemUrls)
        .filter(([, url]) => Boolean(url))
        .map(([key]) => key as SeparationStemName)
    : [];

  const handleDeleteStems = async (): Promise<void> => {
    try {
      setIsDeletingStemsLoading(true);
      const auth = getFirebaseAuth();
      const userId = auth.currentUser?.uid;

      if (!userId) {
        throw new Error('User not authenticated');
      }

      // Get stem names from storage paths
      const stemNames = song.separatedSongInfo?.stems?.paths
        ? Object.keys(song.separatedSongInfo.stems.paths)
        : [];

      // Delete stem files from storage
      if (stemNames.length > 0) {
        await deleteSeparationStems(userId, song.id, stemNames);
      }

      // Delete separation info from Firestore
      await deleteSeparatedSongInfo(userId, song.id);
      setIsDeleteStemsDialogOpen(false);
    } catch (err) {
      console.error('Error deleting stems:', err);
    } finally {
      setIsDeletingStemsLoading(false);
    }
  };

  const handleSeparationSuccess = (provider: 'poyo' | 'local'): void => {
    const message =
      provider === 'poyo'
        ? tAll('SeparationDialog.success.poyo')
        : tAll('SeparationDialog.success.local');
    setSeparationSuccessMessage(message);
    setShowSeparationSuccessSnackbar(true);
  };

  return (
    <Card
      sx={{
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        '&:hover': {
          borderColor: 'rgba(124, 58, 237, 0.6)',
          bgcolor: 'rgba(19, 10, 53, 0.7)',
        },
      }}
    >
      <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
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
            {isCurrent && (
              <Chip
                icon={<PlayCircleIcon />}
                label={t('nowPlaying')}
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

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title={t('tooltips.playSong')}>
              <IconButton
                onClick={onPlay}
                aria-label={t('tooltips.playSong')}
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

            <Tooltip title={t('tooltips.editSong')}>
              <IconButton
                onClick={onEdit}
                aria-label={t('tooltips.editSong')}
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

            <SongDeleteButton
              songId={song.id}
              songTitle={song.title}
              stemNames={
                song.separatedSongInfo?.stems?.paths
                  ? Object.keys(song.separatedSongInfo.stems.paths)
                  : undefined
              }
            />
          </Box>
        </Box>

        {/* Separation status */}
        <Box
          sx={{
            mt: 1,
            p: 2,
            borderRadius: 2,
            border: '1px solid rgba(124, 58, 237, 0.2)',
            bgcolor: 'rgba(124, 58, 237, 0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <GraphicEqIcon fontSize="small" sx={{ color: 'primary.main' }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {tSep('title')}
            </Typography>
          </Box>

          {separationError && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {separationError}
            </Alert>
          )}

          {stemUrlError && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {stemUrlError}
            </Alert>
          )}

          {!song.separatedSongInfo && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {tSep('noSeparationYet')}
              </Typography>
              <Button
                variant="contained"
                onClick={() => setIsSeparationDialogOpen(true)}
              >
                {tSep('startButton')}
              </Button>
            </Box>
          )}

          {song.separatedSongInfo && isProcessing && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {tSep('processing')}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshIcon fontSize="small" />}
                onClick={refreshStatus}
                disabled={isRefreshing}
                sx={{ alignSelf: 'flex-start' }}
              >
                {isRefreshing
                  ? tSep('refreshingStatus')
                  : tSep('refreshStatus')}
              </Button>
            </Box>
          )}

          {isUploadingStems && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {tSep('uploadingStems')}
              </Typography>
            </Box>
          )}

          {song.separatedSongInfo &&
            isFinished &&
            separation &&
            !isUploadingStems && (
              <Stack spacing={1}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    label={`${tSep('provider')} ${separation.provider}`}
                    size="small"
                  />
                  {separation.taskId && (
                    <Chip
                      label={`${tSep('task')} ${separation.taskId}`}
                      size="small"
                    />
                  )}
                </Box>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {tSep('stemsReady')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                  {availableStems.map((stem) => (
                    <Chip
                      key={stem}
                      label={tPlayer(
                        ('stems.' + stem) as Parameters<typeof tPlayer>[0],
                      )}
                      size="small"
                    />
                  ))}
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={() => setIsDeleteStemsDialogOpen(true)}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {t('deleteStemsButton')}
                </Button>
              </Stack>
            )}

          {song.separatedSongInfo && isFailed && separation && (
            <Stack spacing={1.5}>
              <Alert severity="error" sx={{ mb: 0 }}>
                {tSep('failed', {
                  errorMessage: separation.errorMessage ?? 'Unknown error',
                })}
              </Alert>
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshIcon fontSize="small" />}
                onClick={() => setIsSeparationDialogOpen(true)}
                sx={{ alignSelf: 'flex-start' }}
              >
                {tSep('tryAgain')}
              </Button>
            </Stack>
          )}
        </Box>
      </CardContent>

      {/* Separation Dialog */}
      <SeparationDialog
        open={isSeparationDialogOpen}
        onClose={() => setIsSeparationDialogOpen(false)}
        onSuccess={handleSeparationSuccess}
        song={song}
      />

      {/* Delete Stems Confirmation Dialog */}
      <Dialog
        open={isDeleteStemsDialogOpen}
        onClose={() => setIsDeleteStemsDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('deleteStemsTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t('deleteStemsMessage')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setIsDeleteStemsDialogOpen(false)}
            disabled={isDeletingStemsLoading}
          >
            {t('cancelButton')}
          </Button>
          <Button
            onClick={handleDeleteStems}
            color="error"
            variant="contained"
            disabled={isDeletingStemsLoading}
          >
            {isDeletingStemsLoading ? (
              <CircularProgress size={20} sx={{ mr: 1 }} />
            ) : null}
            {t('deleteStemsButton')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={showSeparationSuccessSnackbar}
        autoHideDuration={6000}
        onClose={() => setShowSeparationSuccessSnackbar(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert
          severity="success"
          onClose={() => setShowSeparationSuccessSnackbar(false)}
        >
          {separationSuccessMessage}
        </Alert>
      </Snackbar>
    </Card>
  );
}
