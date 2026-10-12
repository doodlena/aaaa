import { useTranslation } from 'react-i18next';
import { useContactEmail } from '../../state/meta';

/** "Questions or need access? Email …" — renders nothing when the site has no contact email configured. */
export function ContactEmail({ kind = 'questions' }: { kind?: 'questions' | 'claimHelp' }) {
  const { t } = useTranslation();
  const email = useContactEmail();
  if (!email) return null;
  return (
    <p className="contact-email">
      {t(`portal.contact.${kind}`)} <a href={`mailto:${email}`}>{email}</a>
    </p>
  );
}
