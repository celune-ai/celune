import { redirect } from 'next/navigation';
import { URL_MARKETING } from '@/lib/branding';

/** Redirect to the marketing site waitlist section */
export default function WaitlistRedirect() {
  redirect(`${URL_MARKETING}#signup`);
}
