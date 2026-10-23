'use client';

import React from 'react';
import { Tooltip } from 'react-tooltip';
import { ToastContainer } from 'react-toastify';
import BulkPage from '@/bulk/components/BulkPage';

const BulkRoot = () => (
  <>
    <BulkPage />
    <Tooltip id="tooltip" />
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

export default BulkRoot;
