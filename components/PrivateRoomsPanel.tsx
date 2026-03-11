'use client';

import { useState } from 'react';
import { Lock, Shield, Unlock } from 'lucide-react';
import { PRIVATE_ROOMS, type PrivateRoomId } from '@/lib/privateRooms';

interface PrivateRoomsPanelProps {
  activeRoomId: PrivateRoomId;
  unlockedRooms: PrivateRoomId[];
  onSelectRoom: (roomId: PrivateRoomId) => void;
  onUnlockRoom: (roomId: PrivateRoomId, code: string) => boolean;
  roomIds?: PrivateRoomId[];
  className?: string;
}

export default function PrivateRoomsPanel({
  activeRoomId,
  unlockedRooms,
  onSelectRoom,
  onUnlockRoom,
  roomIds,
  className = '',
}: PrivateRoomsPanelProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [unlockError, setUnlockError] = useState('');

  const rooms = roomIds ? PRIVATE_ROOMS.filter((room) => roomIds.includes(room.id)) : PRIVATE_ROOMS;
  const activeRoom = rooms.find((room) => room.id === activeRoomId) || rooms[0] || PRIVATE_ROOMS[0];
  const activeLocked = activeRoom.privacy === 'invite-only' && !unlockedRooms.includes(activeRoom.id);

  return (
    <section className={`${className} rounded-3xl border border-white/7 bg-neutral-950/70 p-4 sm:p-5`}>
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-new-mint" />
          <h3 className="text-sm font-bold uppercase tracking-[0.22em] text-white">Rooms</h3>
        </div>
        <p className="max-w-2xl text-sm text-gray-400">
          Switch between the open feed and invite-only rooms without leaving the market surface.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {rooms.map((room) => {
          const unlocked = room.privacy === 'public' || unlockedRooms.includes(room.id);

          return (
            <button
              key={room.id}
              onClick={() => onSelectRoom(room.id)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-left transition-all ${
                activeRoomId === room.id
                  ? 'border-new-mint/25 bg-new-mint/[0.08] text-white'
                  : 'border-white/8 bg-white/[0.03] text-gray-300 hover:border-white/14 hover:text-white'
              }`}
            >
              {unlocked ? (
                <Unlock className={`h-3.5 w-3.5 ${activeRoomId === room.id ? 'text-new-mint' : 'text-gray-500'}`} />
              ) : (
                <Lock className="h-3.5 w-3.5 text-gray-500" />
              )}
              <span className="text-sm font-semibold">{room.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] ${
                unlocked
                  ? 'bg-new-mint/10 text-new-mint'
                  : 'bg-white/[0.03] text-gray-500'
              }`}>
                {unlocked ? 'Open' : 'Private'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-[1.5rem] border border-white/6 bg-black/35 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">{activeRoom.name}</p>
            <p className="mt-1 text-sm text-gray-400">{activeRoom.description}</p>
          </div>

          {activeLocked ? (
            <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[440px] lg:flex-row">
              <input
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder={`Unlock ${activeRoom.name}`}
                className="flex-1 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-new-mint/30"
              />
              <button
                onClick={() => {
                  const ok = onUnlockRoom(activeRoom.id, inviteCode);
                  if (ok) {
                    setInviteCode('');
                    setUnlockError('');
                  } else {
                    setUnlockError('Invalid invite code');
                  }
                }}
                className="rounded-2xl border border-new-mint/20 bg-new-mint/10 px-4 py-3 text-sm font-bold uppercase tracking-[0.2em] text-new-mint transition-colors hover:bg-new-mint/15"
              >
                Unlock
              </button>
            </div>
          ) : (
            <div className="rounded-full border border-new-mint/15 bg-new-mint/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-new-mint">
              Room available
            </div>
          )}
        </div>

        {unlockError && (
          <p className="mt-3 text-sm text-off-red">{unlockError}</p>
        )}
      </div>
    </section>
  );
}
