import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { ResumeViewer } from '@/components/activity/ResumeViewer';
import { makeStyles } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useResumes } from '@/hooks/useResumes';

/**
 * One resume, open at the document — a route rather than a modal, on purpose.
 *
 * It was a React Native `Modal` rendered from Activity, which draws in its own window above the
 * navigator. Nothing pushed could appear over it, so opening the parse review meant closing the
 * viewer first, and dismissing the review landed the reader on Activity rather than back on the
 * document the review was about. `app/story.tsx` hit the same wall and took the same way out.
 *
 * As a route the review is an ordinary push on top of this, and swiping it away reveals the PDF
 * underneath, which is what the stack is for.
 *
 * The data is read here rather than handed down from Activity: a route can be arrived at from
 * anywhere — a notification, a deep link, a reload in development — and one that depends on
 * another screen's state would be a blank page in every case but the one it was built for.
 */
export default function ResumeScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { userId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { resumes, setDefault, openUrl } = useResumes(userId);
  const resume = resumes.find((entry) => entry.id === id) ?? null;

  return (
    <View style={styles.screen}>
      <ResumeViewer
        resume={resume}
        isDefault={resume?.isDefault ?? false}
        onClose={() => router.back()}
        onSetDefault={() => {
          if (resume) void setDefault(resume.id);
        }}
        // Pushed, not swapped: this screen stays underneath, so dismissing the review comes
        // back to the page it was describing.
        onReviewParse={() => {
          if (resume) router.push({ pathname: '/resume-review', params: { id: resume.id } });
        }}
        onRequestUrl={openUrl}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // The viewer's own sheet is absolutely positioned, so it needs a filled box to sit in.
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
}));
