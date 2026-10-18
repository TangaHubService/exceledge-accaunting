import { SettingsLayout } from "../../components/settings/SettingsLayout";

export function SettingsPlaceholder({ title, blurb }: { title: string; blurb: string }) {
  return (
    <SettingsLayout title={title} subtitle={blurb}>
      <section className="ee-settings-card">
        <p className="muted">Settings for {title.toLowerCase()} will appear here. Dummy layout matches the Settings chrome.</p>
      </section>
    </SettingsLayout>
  );
}
