'use client';

interface OrbFallbackProps {
  mouse: { x: number; y: number };
}

export default function OrbFallback({ mouse }: OrbFallbackProps) {
  const tiltX = mouse.y * 12;
  const tiltY = mouse.x * -12;

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div
        className="relative"
        style={{
          transform: `perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
          transition: 'transform 0.3s ease-out',
        }}
      >
        {/* Outer glow */}
        <div
          className="absolute inset-0 rounded-full blur-3xl opacity-30"
          style={{
            background: 'radial-gradient(circle, #34D399 0%, #60A5FA 50%, transparent 70%)',
            width: '320px',
            height: '320px',
            marginLeft: '-10px',
            marginTop: '-10px',
          }}
        />

        {/* Main orb */}
        <div
          className="relative rounded-full border border-zinc-600/30"
          style={{
            width: '300px',
            height: '300px',
            background: 'radial-gradient(circle at 35% 35%, rgba(52,211,153,0.2) 0%, rgba(96,165,250,0.1) 40%, rgba(15,15,15,0.8) 70%)',
            boxShadow: `
              inset 0 0 60px rgba(52,211,153,0.15),
              inset 0 0 120px rgba(96,165,250,0.08),
              0 0 40px rgba(52,211,153,0.1),
              0 0 80px rgba(96,165,250,0.05)
            `,
            animation: 'orbFloat 4s ease-in-out infinite, orbPulse 3s ease-in-out infinite',
          }}
        >
          {/* Specular highlight */}
          <div
            className="absolute rounded-full"
            style={{
              width: '80px',
              height: '50px',
              top: '25%',
              left: '22%',
              background: 'radial-gradient(ellipse, rgba(255,255,255,0.2) 0%, transparent 70%)',
              transform: 'rotate(-20deg)',
            }}
          />

          {/* Inner particles (CSS dots) */}
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: `${3 + (i % 3) * 2}px`,
                height: `${3 + (i % 3) * 2}px`,
                background: ['#34D399', '#60A5FA', '#F472B6'][i % 3],
                opacity: 0.5 + Math.random() * 0.3,
                top: `${25 + Math.sin(i * 1.2) * 25}%`,
                left: `${25 + Math.cos(i * 1.2) * 25}%`,
                animation: `orbParticle ${2 + i * 0.3}s ease-in-out infinite alternate`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes orbFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        @keyframes orbPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @keyframes orbParticle {
          0% { transform: translate(0, 0); opacity: 0.3; }
          100% { transform: translate(8px, -6px); opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
