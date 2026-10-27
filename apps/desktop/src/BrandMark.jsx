import React from 'react';
import owl from '../branding/azwol-owl.png';

export default function BrandMark({ size = 36, className = '' }) {
  return <img src={owl} width={size} height={size} className={`azwol-mark ${className}`} alt="" aria-hidden="true" draggable="false" />;
}
