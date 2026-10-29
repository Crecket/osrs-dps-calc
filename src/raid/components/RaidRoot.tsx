'use client';

import React from 'react';
import { Tooltip } from 'react-tooltip';
import { ToastContainer } from 'react-toastify';
import RaidPage from '@/raid/components/RaidPage';

const RaidRoot = () => (
  <>
    <RaidPage />
    <Tooltip id="tooltip" />
    <ToastContainer position="bottom-right" hideProgressBar draggable={false} limit={3} closeButton={false} className="text-sm" />
  </>
);

export default RaidRoot;
