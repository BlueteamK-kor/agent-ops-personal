import React, { lazy, Suspense } from 'react';

const Markdown = lazy(() => import('./DocumentPreview'));

export default function MessageContent({ content }) {
  return <Suspense fallback={<p>{content}</p>}>
    <Markdown content={content} className="message-markdown" />
  </Suspense>;
}
