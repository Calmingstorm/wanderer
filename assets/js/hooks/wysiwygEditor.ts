import type { Hook } from 'phoenix_live_view';
import Quill from 'quill';
import TurndownService from 'turndown';

const WysiwygEditor: Hook = {
  mounted() {
    const editorContainer = this.el.querySelector<HTMLElement>('.ql-editor-container');
    if (!editorContainer) return;

    const toolbarOptions = [
      ['bold', 'italic', 'underline', 'strike'],
      ['blockquote', 'link'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ header: [1, 2, 3, false] }],
      ['clean'],
    ];

    const quill = new Quill(editorContainer, {
      theme: 'snow',
      modules: { toolbar: toolbarOptions },
    });

    const initialContent = editorContainer.dataset.initialContent;
    if (initialContent) quill.clipboard.dangerouslyPasteHTML(initialContent);

    quill.on('text-change', () => {
      this.pushEvent('content-text-change', { content: quill.getText() });
    });

    this.handleEvent('request_editor_content', () => {
      const markdown = quill.getText().trim() === '' ? '' : new TurndownService().turndown(quill.root.innerHTML);
      this.pushEvent('editor_content_markdown', { markdown });
    });
  },
};

export default WysiwygEditor;
