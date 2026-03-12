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
}

export default function PrivateRoomsPanel({
  activeRoomId,
  unlockedRooms,
  onSelectRoom,
  onUnlockRoom,
  roomIds,
}: PrivateRoomsPanelProps) {
  const [inviteCode, setInviteCode] = useState('');
  const [unlockError, setUnlockError] = useState('');

  const rooms = roomIds ? PRIVATE_ROOMS.filter((room) => roomIds.includes(room.id)) : PRIVATE_ROOMS;
  const activeRoom = rooms.find((room) => room.id === activeRoomId) || rooms[0] || PRIVATE_ROOMS[0];
  const activeLocked = activeRoom.privacy === 'invite-only' && !unlockedRooms.includes(activeRoom.id);

  return (
    <section className="mt-6 rounded-3xl border border-white/7 bg-neutral-950/70 p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-new-mint" />
          <h3 className="text-lg font-bold text-white">Private Rooms</h3>
        </div>
        <p className="text-sm text-gray-400">
          Invite-only rooms hide curated mirrored markets behind room access, so sensitive consensus stays inside the group.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        {rooms.map((room) => {
          const unlocked = room.privacy === 'public' || unlockedRooms.includes(room.id);

          return (
            <button
              key={room.id}
              onClick={() => onSelectRoom(room.id)}
              className={`rounded-2xl border p-4 text-left transition-all ${
                activeRoomId === room.id
                  ? 'border-new-mint/25 bg-new-mint/[0.06]'
                  : 'border-white/6 bg-black/35 hover:border-white/12'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-white">{room.name}</span>
                {unlocked ? (
                  <Unlock className="h-4 w-4 text-new-mint" />
                ) : (
                  <Lock className="h-4 w-4 text-gray-500" />
                )}
              </div>
              <p className="text-xs text-gray-400">{room.description}</p>
              <p className={`mt-3 text-[10px] font-bold uppercase tracking-[0.24em] ${
                unlocked ? 'text-new-mint' : 'text-gray-500'
              }`}>
                {unlocked ? 'Accessible' : room.privacy}
              </p>
            </button>
          );
        })}
      </div>

      {activeLocked && (
        <div className="mt-4 rounded-2xl border border-white/6 bg-black/35 p-4">
          <p className="mb-3 text-sm text-gray-300">
            Unlock <span className="font-bold text-white">{activeRoom.name}</span> with its invite code.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="Enter invite code"
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
          {unlockError && (
            <p className="mt-3 text-sm text-off-red">{unlockError}</p>
          )}
        </div>
      )}
    </section>
  );
}
