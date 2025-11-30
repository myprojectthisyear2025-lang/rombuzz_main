// src/components/GamesManager.jsx
import React from "react";
import CouplesTruthDareGame from "./CouplesTruthDareGame";
import FlirtyDiceGame from "./FlirtyDiceGame";
import WouldYouRatherGame from "./WouldYouRatherGame";
import SpinTheBottleGame from "./SpinTheBottleGame";
import StoryBuilderGame from "./StoryBuilderGame";
import MemoryCardGame from "./MemoryCardGame";

/**
 * GamesManager
 *
 * This keeps ChatWindow clean (only ONE import)
 * and manages all game modals in one place.
 *
 * Props:
 *  - states: { gameOpen, diceOpen, wyrOpen, bottleOpen, storyOpen, memoryOpen }
 *  - setters: { setGameOpen, setDiceOpen, setWyrOpen, setBottleOpen, setStoryOpen, setMemoryOpen }
 *  - partnerName, socket, roomId, myId, peerId
 */

export default function GamesManager({
  states,
  setters,
  partnerName,
  socket,
  roomId,
  myId,
  peerId,
}) {
  const {
    gameOpen,
    diceOpen,
    wyrOpen,
    bottleOpen,
    storyOpen,
    memoryOpen,
  } = states;

  const {
    setGameOpen,
    setDiceOpen,
    setWyrOpen,
    setBottleOpen,
    setStoryOpen,
    setMemoryOpen,
  } = setters;

  return (
    <>
      <CouplesTruthDareGame
        open={gameOpen}
        onClose={() => setGameOpen(false)}
        partnerName={partnerName}
        socket={socket}
        roomId={roomId}
        myId={myId}
        peerId={peerId}
      />

      <FlirtyDiceGame
        open={diceOpen}
        onClose={() => setDiceOpen(false)}
        partnerName={partnerName}
        socket={socket}
        roomId={roomId}
        myId={myId}
        peerId={peerId}
      />

      <WouldYouRatherGame
        open={wyrOpen}
        onClose={() => setWyrOpen(false)}
        partnerName={partnerName}
        socket={socket}
        roomId={roomId}
        myId={myId}
        peerId={peerId}
      />

      <SpinTheBottleGame
        open={bottleOpen}
        onClose={() => setBottleOpen(false)}
        partnerName={partnerName}
        socket={socket}
        roomId={roomId}
        myId={myId}
        peerId={peerId}
      />

      <StoryBuilderGame
        open={storyOpen}
        onClose={() => setStoryOpen(false)}
        partnerName={partnerName}
        socket={socket}
        roomId={roomId}
        myId={myId}
        peerId={peerId}
      />

      <MemoryCardGame
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        partnerName={partnerName}
        socket={socket}
        roomId={roomId}
        myId={myId}
        peerId={peerId}
      />
    </>
  );
}
