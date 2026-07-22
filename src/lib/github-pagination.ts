export async function collectPages<T>(
	fetchPage: (page: number, perPage: number) => Promise<T[]>,
	perPage = 100,
): Promise<T[]> {
	const items: T[] = [];
	for (let page = 1; ; page += 1) {
		const pageItems = await fetchPage(page, perPage);
		items.push(...pageItems);
		if (pageItems.length < perPage) return items;
	}
}
