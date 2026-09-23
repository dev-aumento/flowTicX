export const LIST_PAGE_SIZE = 20;

export function paginateItems<T>(items: T[], page: number, pageSize = LIST_PAGE_SIZE) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    totalItems,
    pageSize,
    startIndex: totalItems === 0 ? 0 : start + 1,
    endIndex: Math.min(start + pageSize, totalItems),
  };
}

export function pageForItemIndex(index: number, pageSize = LIST_PAGE_SIZE) {
  if (index < 0) return 1;
  return Math.floor(index / pageSize) + 1;
}
