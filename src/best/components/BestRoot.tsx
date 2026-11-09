'use client';

import React from 'react';
import { Tooltip } from 'react-tooltip';
import PageTooltip from '@/bulk/components/PageTooltip';
import { ToastContainer } from 'react-toastify';
import BestPage from '@/best/components/BestPage';

const BestRoot = () => (
  <>
    <BestPage />
    <PageTooltip />
    <Tooltip id="tooltip-warning" />
    <ToastContainer
      position="bottom-right"
      hideProgressBar
      draggable={false}
      limit={3}
      closeButton={false}
      className="text-sm"
    />
  </>
);

export default BestRoot;
