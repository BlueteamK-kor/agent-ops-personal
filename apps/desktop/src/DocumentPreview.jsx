import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './markdown.css';

// Model text never loads remote images, executes HTML, or navigates the app.
const components = {
  a: ({ children }) => <span className="workspace-link-text">{children}</span>,
  img: ({ alt }) => <span className="workspace-image-caption">{alt}</span>,
};
export default function DocumentPreview({ content, label, className = 'workspace-markdown' }) {
  return <div className={`rendered-markdown ${className}`} aria-label={label}>
    <Markdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={() => ''} components={components}>{content}</Markdown>
  </div>;
}
