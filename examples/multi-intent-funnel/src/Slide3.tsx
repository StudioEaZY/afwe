import React from 'react';
import { getFunnelState, updateFunnelSeatCount } from './activation/funnelState';

export const Slide3: React.FC = () => {
  const [seats, setSeats] = React.useState(10);

  const handleUpdate = (val: number) => {
    setSeats(val);
    updateFunnelSeatCount(val);
  };

  return (
    <div className="slide slide-seats">
      <h2>Configure Team Workspace Seats</h2>
      <button onClick={() => handleUpdate(seats + 5)}>Add 5 Seats</button>
      <p>Current active seats selected: {seats}</p>
    </div>
  );
};
