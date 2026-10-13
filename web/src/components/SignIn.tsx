import { useId, useState, type FormEvent } from 'react';
import { ApiError, api, type ParticipantDTO, type ViewerDTO } from '../api';

interface Props {
  eventId: string;
  onSignedIn: (participant: ParticipantDTO, viewer: ViewerDTO) => void;
}

export function SignInPanel({ eventId, onSignedIn }: Props) {
  const uid = useId();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrongPassword, setWrongPassword] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter your name');
      return;
    }
    setBusy(true);
    setError(null);
    setWrongPassword(false);
    try {
      const r = await api.signIn(eventId, trimmed, password || undefined);
      onSignedIn(r.participant, r.viewer);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_password') {
        setWrongPassword(true);
        setError('That password does not match this name.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
      }
      setBusy(false);
    }
  }

  return (
    <form className="m-card m-signin" onSubmit={submit} aria-labelledby={`${uid}-t`} noValidate>
      <div className="m-card-header">
        <div>
          <h2 className="m-card-title" id={`${uid}-t`}>
            Add your availability
          </h2>
          <p className="m-card-sub">Enter your name to get started. Coming back? Use the same name.</p>
        </div>
      </div>
      <div className="m-card-body">
        <div className="m-field">
          <label className="m-label" htmlFor={`${uid}-n`}>
            Your name
          </label>
          <input
            id={`${uid}-n`}
            className="m-input"
            value={name}
            maxLength={40}
            autoComplete="nickname"
            placeholder="Alex"
            aria-invalid={!!error && !wrongPassword}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="m-field">
          <label className="m-label" htmlFor={`${uid}-p`}>
            Password <span className="m-optional">(optional)</span>
          </label>
          <input
            id={`${uid}-p`}
            className="m-input"
            type="password"
            value={password}
            maxLength={128}
            autoComplete="off"
            aria-invalid={wrongPassword}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="m-hint">Protects your row so others cannot edit it.</span>
        </div>
        {error && (
          <span className="m-error" role="alert">
            {error}
          </span>
        )}
        <button type="submit" className="m-button is-primary" disabled={busy}>
          {busy ? 'Signing in...' : 'Continue'}
        </button>
      </div>
    </form>
  );
}
