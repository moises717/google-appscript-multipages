import { useEffect } from 'react';
import { AppSidebar } from '@/client/components/app-sidebar';
import { ChartAreaInteractive } from '@/client/components/chart-area-interactive';
import { SectionCards } from '@/client/components/section-cards';
import { SiteHeader } from '@/client/components/site-header';
import { SidebarInset, SidebarProvider } from '@/client/components/ui/sidebar';
import { DataTable } from '@/client/components/data-table';
import { serverFunctions } from '@/client/lib/client';
import type { Account } from '@/client/types';
import data from '@/client/data.json';

function App() {
	useEffect(() => {
		getData();
	}, []);

	async function getData() {
		const data = (await serverFunctions.sheetToJsonFromName('Cuentas', { useDisplayValues: true })) as Account[];
		console.log(data);
	}

	return (
		<SidebarProvider
			style={
				{
					'--sidebar-width': 'calc(var(--spacing) * 72)',
					'--header-height': 'calc(var(--spacing) * 12)',
				} as React.CSSProperties
			}>
			<AppSidebar variant='inset' />
			<SidebarInset>
				<SiteHeader />
				<div className='flex flex-1 flex-col '>
					<div className='@container/main flex flex-1 flex-col gap-2'>
						<div className='flex flex-col gap-4 py-4 md:gap-6 md:py-6'>
							<SectionCards />
							<div className='px-4 lg:px-6'>
								<ChartAreaInteractive />
							</div>
							<DataTable data={data} />
						</div>
					</div>
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}

export default App;
