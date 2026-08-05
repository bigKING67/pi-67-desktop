import { ChevronDown, FilePlus2, FolderPlus, LoaderCircle, Plus, RefreshCw, Search } from "lucide-react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import type { FormEvent } from "react";

export function WorkspaceFilesToolbar({
  query,
  includeGenerated,
  searching,
  refreshing,
  onQueryChange,
  onIncludeGeneratedChange,
  onSearch,
  onCreateFile,
  onCreateDirectory,
  onRefresh
}: {
  query: string;
  includeGenerated: boolean;
  searching: boolean;
  refreshing: boolean;
  onQueryChange: (query: string) => void;
  onIncludeGeneratedChange: (includeGenerated: boolean) => void;
  onSearch: () => void;
  onCreateFile: () => void;
  onCreateDirectory: () => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <form className="inspector-search" onSubmit={submitSearch}>
        <Search aria-hidden="true" size={14} />
        <input
          aria-label="搜索工作区文件"
          maxLength={256}
          placeholder="搜索文件名或路径"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <button disabled={searching || !query.trim()} type="submit">
          {searching ? <LoaderCircle aria-label="搜索中" className="spin" size={13} /> : "搜索"}
        </button>
      </form>
      <div className="inspector-files-toolbar">
        <label title="在文件树和搜索结果中显示依赖与生成目录">
          <input
            checked={includeGenerated}
            type="checkbox"
            onChange={(event) => onIncludeGeneratedChange(event.target.checked)}
          />
          显示依赖/生成目录
        </label>
        <div className="inspector-files-toolbar-actions">
          <MenuTrigger>
            <Button
              aria-describedby="workspace-create-tooltip"
              aria-label="新建工作区项目"
              className="inspector-toolbar-button inspector-new-button"
            >
              <Plus aria-hidden="true" size={14} />
              <ChevronDown aria-hidden="true" size={12} />
              <span className="inspector-toolbar-tooltip" id="workspace-create-tooltip" role="tooltip">
                新建文件或文件夹
              </span>
            </Button>
            <Popover className="inspector-file-menu-popover" placement="bottom end" offset={4}>
              <Menu aria-label="新建工作区项目" className="inspector-file-menu">
                <MenuItem onAction={onCreateFile}><FilePlus2 aria-hidden="true" size={14} />新建文件</MenuItem>
                <MenuItem onAction={onCreateDirectory}><FolderPlus aria-hidden="true" size={14} />新建文件夹</MenuItem>
              </Menu>
            </Popover>
          </MenuTrigger>
          <Button
            aria-describedby="workspace-refresh-tooltip"
            aria-label={refreshing ? "正在刷新文件" : "刷新文件"}
            className="inspector-toolbar-button inspector-refresh-button"
            isDisabled={refreshing}
            onPress={onRefresh}
          >
            <RefreshCw aria-hidden="true" className={refreshing ? "spin" : undefined} size={14} />
            <span className="inspector-toolbar-tooltip" id="workspace-refresh-tooltip" role="tooltip">
              刷新文件
            </span>
          </Button>
        </div>
      </div>
    </>
  );

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSearch();
  }
}
