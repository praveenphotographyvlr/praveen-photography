'use client'
import { useLogo } from '@/app/context/LogoContext'

interface PhotoLoaderProps {
  /** true = full-viewport branded loader (customer portal)
   *  false/omitted = compact centred loader (admin sections) */
  fullPage?: boolean
  message?: string
}

export default function PhotoLoader({ fullPage = false, message = 'Loading…' }: PhotoLoaderProps) {
  const logoUrl = useLogo()
  const apertureStyles = `
    @keyframes aperture-spin {
      0%   { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes aperture-pulse {
      0%, 100% { opacity: 0.15; transform: scale(1); }
      50%       { opacity: 0.35; transform: scale(1.08); }
    }
    @keyframes loader-fade-in {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes dot-bounce {
      0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
      40%           { opacity: 1;   transform: translateY(-5px); }
    }
    .pl-ring-1 { animation: aperture-pulse 2.4s ease-in-out infinite; }
    .pl-ring-2 { animation: aperture-pulse 2.4s ease-in-out infinite 0.4s; }
    .pl-ring-3 { animation: aperture-pulse 2.4s ease-in-out infinite 0.8s; }
    .pl-spin   { animation: aperture-spin 3.5s linear infinite; }
    .pl-wrap   { animation: loader-fade-in 0.6s ease both; }
    .pl-dot1   { animation: dot-bounce 1.4s ease-in-out infinite 0s; }
    .pl-dot2   { animation: dot-bounce 1.4s ease-in-out infinite 0.2s; }
    .pl-dot3   { animation: dot-bounce 1.4s ease-in-out infinite 0.4s; }
  `

  const aperture = (
    <div style={{ position: 'relative', width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="pl-ring-1" style={{ position: 'absolute', width: 90, height: 90, borderRadius: '50%', border: '1px solid rgba(212,160,23,0.3)' }} />
      <div className="pl-ring-2" style={{ position: 'absolute', width: 68, height: 68, borderRadius: '50%', border: '1px solid rgba(212,160,23,0.45)' }} />
      <div className="pl-ring-3" style={{ position: 'absolute', width: 48, height: 48, borderRadius: '50%', border: '1px solid rgba(212,160,23,0.6)' }} />
      <div className="pl-spin" style={{ position: 'absolute', width: 60, height: 60 }}>
        <svg viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
          {[0, 60, 120, 180, 240, 300].map((deg, index) => {
            const r = 28, cx = 36, cy = 36, p = Math.PI / 180
            const x1 = (cx + r * Math.cos((deg - 20) * p)).toFixed(4)
            const y1 = (cy + r * Math.sin((deg - 20) * p)).toFixed(4)
            const x2 = (cx + r * Math.cos((deg + 20) * p)).toFixed(4)
            const y2 = (cy + r * Math.sin((deg + 20) * p)).toFixed(4)
            return (
              <path
                key={index}
                d={`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2} Z`}
                fill={`rgba(212,160,23,${0.18 + index * 0.03})`}
                stroke="rgba(212,160,23,0.5)"
                strokeWidth="0.5"
              />
            )
          })}
          <circle cx="36" cy="36" r="10" fill="#0a0a0a" stroke="rgba(212,160,23,0.6)" strokeWidth="1" />
        </svg>
      </div>
      <div style={{ position: 'absolute', zIndex: 2, width: 20, height: 20, borderRadius: '50%', overflow: 'hidden' }}><img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
    </div>
  )

  if (fullPage) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0a0a0a', flexDirection: 'column' }}>
        <style>{apertureStyles}</style>
        <div className="pl-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
          <div style={{ position: 'relative', width: 110, height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="pl-ring-1" style={{ position: 'absolute', width: 110, height: 110, borderRadius: '50%', border: '1px solid rgba(212,160,23,0.3)' }} />
            <div className="pl-ring-2" style={{ position: 'absolute', width: 84, height: 84, borderRadius: '50%', border: '1px solid rgba(212,160,23,0.45)' }} />
            <div className="pl-ring-3" style={{ position: 'absolute', width: 60, height: 60, borderRadius: '50%', border: '1px solid rgba(212,160,23,0.6)' }} />
            <div className="pl-spin" style={{ position: 'absolute', width: 72, height: 72 }}>
              <svg viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
                {[0, 60, 120, 180, 240, 300].map((deg, index) => {
                  const r = 28, cx = 36, cy = 36, p = Math.PI / 180
                  const x1 = (cx + r * Math.cos((deg - 20) * p)).toFixed(4)
                  const y1 = (cy + r * Math.sin((deg - 20) * p)).toFixed(4)
                  const x2 = (cx + r * Math.cos((deg + 20) * p)).toFixed(4)
                  const y2 = (cy + r * Math.sin((deg + 20) * p)).toFixed(4)
                  return (
                    <path
                      key={index}
                      d={`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2} Z`}
                      fill={`rgba(212,160,23,${0.18 + index * 0.03})`}
                      stroke="rgba(212,160,23,0.5)"
                      strokeWidth="0.5"
                    />
                  )
                })}
                <circle cx="36" cy="36" r="10" fill="#0a0a0a" stroke="rgba(212,160,23,0.6)" strokeWidth="1" />
              </svg>
            </div>
            <div style={{ position: 'absolute', zIndex: 2, width: 24, height: 24, borderRadius: '50%', overflow: 'hidden' }}><img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: '#f0d78c', fontWeight: 600, marginBottom: 6, letterSpacing: '0.02em' }}>
              Praveen Photography
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#555' }}>{message}</span>
              <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <span className="pl-dot1" style={{ width: 4, height: 4, borderRadius: '50%', background: '#d4a017', display: 'inline-block' }} />
                <span className="pl-dot2" style={{ width: 4, height: 4, borderRadius: '50%', background: '#d4a017', display: 'inline-block' }} />
                <span className="pl-dot3" style={{ width: 4, height: 4, borderRadius: '50%', background: '#d4a017', display: 'inline-block' }} />
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', gap: 16 }}>
      <style>{apertureStyles}</style>
      <div className="pl-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        {aperture}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#555' }}>{message}</span>
          <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <span className="pl-dot1" style={{ width: 3, height: 3, borderRadius: '50%', background: '#d4a017', display: 'inline-block' }} />
            <span className="pl-dot2" style={{ width: 3, height: 3, borderRadius: '50%', background: '#d4a017', display: 'inline-block' }} />
            <span className="pl-dot3" style={{ width: 3, height: 3, borderRadius: '50%', background: '#d4a017', display: 'inline-block' }} />
          </span>
        </div>
      </div>
    </div>
  )
}
