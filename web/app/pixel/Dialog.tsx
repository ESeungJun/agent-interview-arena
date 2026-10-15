import type { ReactNode } from 'react';
import { CAST, px, type CastKey } from './cast';

/** RPG 식 대화창: 면접관 얼굴 + 이름 + 대사 */
export default function Dialog({ speaker, children }: { speaker: CastKey; children: ReactNode }) {
  const s = CAST[speaker];
  return (
    <div className={`dialog speaker-${speaker}`}>
      <img className="dialog-face" {...px(s.sprite)} alt={s.name} />
      <div className="dialog-body">
        <p className="dialog-name">{s.name} <span>· {s.role}</span></p>
        {children}
      </div>
    </div>
  );
}
