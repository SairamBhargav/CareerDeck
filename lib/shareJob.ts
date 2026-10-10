import { Platform, Share } from 'react-native';

import type { Job } from '@/types';

/**
 * Hands a posting to the system share sheet: Messages, Mail, or anything else on the phone,
 * including sending it to yourself. What travels is the employer's own posting link, so it
 * opens for anyone, with or without the app.
 *
 * iOS takes the link separately, which gets Messages its preview card and Mail its subject.
 * Android has one text field, so the link rides at the end of it, and `title` becomes an
 * email's subject.
 */
export async function shareJob(job: Job): Promise<void> {
  const headline = `${job.title} at ${job.companyName}`;
  const url = job.applicationUrl;

  try {
    if (Platform.OS === 'ios') {
      await Share.share({ message: headline, url }, { subject: headline });
    } else {
      await Share.share({ title: headline, message: `${headline}\n${url}` }, { dialogTitle: 'Share this job' });
    }
  } catch {
    // The sheet failed to open; there is nothing to recover and no half-sent state to undo.
  }
}
