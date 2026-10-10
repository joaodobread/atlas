export interface MarkdownFile {
  /** Caminho absoluto. */
  path: string;
  content: string;
}

export interface IMarkdownFolder {
  exists(dir: string): boolean;
  /** Todos os .md da pasta (recursivo; ignora node_modules, .git e afins). */
  scan(dir: string): Promise<MarkdownFile[]>;
  /** Observa mudanças; retorna a função para parar. */
  watch(dir: string, onChange: () => void): () => void;
}
