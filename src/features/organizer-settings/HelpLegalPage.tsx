import { readSettingsConfig, settingsMailto } from './settings.config'
export function HelpLegalPage() {
  const config = readSettingsConfig(import.meta.env)
  return <section className='settings-panel'><h2>Help & Legal</h2><p className='settings-description'>A little help when you need it.</p>
    <div className='settings-row'><div><h3>Contact support</h3><p>{config.supportEmail ? 'Open an email draft for the support team.' : 'Support contact is currently unavailable.'}</p></div>{config.supportEmail && <a className='settings-link' href={settingsMailto(config.supportEmail, 'Organizer support')}>Open email app ↗</a>}</div>
    <div className='settings-row'><div><h3>Report a problem</h3><p>{config.supportEmail ? 'Describe what happened. Avoid including passwords or ticket credentials.' : 'Problem reporting is currently unavailable.'}</p></div>{config.supportEmail && <a className='settings-link' href={settingsMailto(config.supportEmail, 'Organizer problem report')}>Open email app ↗</a>}</div>
    <div className='settings-row'><div><h3>Terms</h3>{!config.termsUrl && <p>Terms are currently unavailable.</p>}</div>{config.termsUrl && <a className='settings-link' href={config.termsUrl} target='_blank' rel='noopener noreferrer'>Read Terms ↗</a>}</div>
    <div className='settings-row'><div><h3>Privacy</h3>{!config.privacyUrl && <p>Privacy information is currently unavailable.</p>}</div>{config.privacyUrl && <a className='settings-link' href={config.privacyUrl} target='_blank' rel='noopener noreferrer'>Read Privacy ↗</a>}</div>
  </section>
}
