import React from 'react';
import { Tooltip } from 'react-tooltip';

/** The page's tooltip, which a tap or keyboard focus opens too: there's no hovering on a touch screen */
const PageTooltip: React.FC = () => (
  <Tooltip
    id="tooltip"
    openEvents={{ mouseenter: true, focus: true, click: true }}
    closeEvents={{ mouseleave: true, blur: true }}
    globalCloseEvents={{ clickOutsideAnchor: true, escape: true }}
  />
);

export default PageTooltip;
