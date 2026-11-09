'use client';

import React from 'react';
import PageTooltip from '@/bulk/components/PageTooltip';
import { ToastContainer } from 'react-toastify';
import RaidPage from '@/raid/components/RaidPage';

const RaidRoot = () => (
  <>
    <RaidPage />
    <PageTooltip />
    <ToastContainer position="bottom-right" hideProgressBar draggable={false} limit={3} closeButton={false} className="text-sm" />
  </>
);

export default RaidRoot;
