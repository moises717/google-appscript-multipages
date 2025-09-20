import * as React from 'react';
import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
	type UniqueIdentifier,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconChevronsLeft,
	IconChevronsRight,
	IconDotsVertical,
	IconGripVertical,
	IconPlus,
} from '@tabler/icons-react';
import {
	type ColumnDef,
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFacetedRowModel,
	getFacetedUniqueValues,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type Row,
	type SortingState,
	useReactTable,
	type VisibilityState,
} from '@tanstack/react-table';
import { z } from 'zod';

import { Badge } from '@/client/components/ui/badge';
import { Button } from '@/client/components/ui/button';
import { Checkbox } from '@/client/components/ui/checkbox';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/client/components/ui/dropdown-menu';
import { Label } from '@/client/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/client/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/client/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/client/components/ui/tabs';

export const schema = z.object({
	Tipo: z.string(),
	Categoria: z.string(),
	ReferenciaID: z.string(),
	Fecha: z.date(),
	Monto: z.number(),
	CuentaID: z.string(),
	Descripcion: z.string(),
	ID: z.string(),
});

// Create a separate component for the drag handle
function DragHandle({ id }: { id: string }) {
	const { attributes, listeners } = useSortable({
		id,
	});

	return (
		<Button {...attributes} {...listeners} variant='ghost' size='icon' className='text-muted-foreground size-7 hover:bg-transparent'>
			<IconGripVertical className='text-muted-foreground size-3' />
			<span className='sr-only'>Drag to reorder</span>
		</Button>
	);
}

const columns: ColumnDef<z.infer<typeof schema>>[] = [
	{
		id: 'drag',
		header: () => null,
		cell: ({ row }) => <DragHandle id={row.original.ID} />,
	},
	{
		id: 'select',
		header: ({ table }) => (
			<div className='flex items-center justify-center'>
				<Checkbox
					checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
					onCheckedChange={value => table.toggleAllPageRowsSelected(!!value)}
					aria-label='Select all'
				/>
			</div>
		),
		cell: ({ row }) => (
			<div className='flex items-center justify-center'>
				<Checkbox checked={row.getIsSelected()} onCheckedChange={value => row.toggleSelected(!!value)} aria-label='Select row' />
			</div>
		),
		enableSorting: false,
		enableHiding: false,
	},
	{
		accessorKey: 'Fecha',
		header: 'Fecha',
		cell: ({ row }) => {
			const fecha = new Date(row.getValue('Fecha'));
			const formatted = fecha.toLocaleDateString('es-NI', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			});
			return <div className='font-medium'>{formatted}</div>;
		},
	},
	{
		accessorKey: 'Descripcion',
		header: 'Descripción',
		cell: ({ row }) => {
			return <div className='w-auto font-medium'>{row.getValue('Descripcion')}</div>;
		},
		enableHiding: false,
	},
	{
		accessorKey: 'Categoria',
		header: 'Categoría',
		cell: ({ row }) => {
			return <div className='w-32'>{row.getValue('Categoria')}</div>;
		},
	},
	{
		accessorKey: 'Monto',
		header: () => <div className='text-right'>Monto</div>,
		cell: ({ row }) => {
			const amount = parseFloat(row.getValue('Monto'));
			const tipo = row.original.Tipo;
			// Assuming NIO for now. This might need to be dynamic based on account.
			const formatted = new Intl.NumberFormat('es-NI', {
				style: 'currency',
				currency: 'NIO',
			}).format(amount);

			return <div className={`text-right font-medium ${tipo === 'Ingreso' ? 'text-green-600' : 'text-red-600'}`}>{formatted}</div>;
		},
	},
	{
		accessorKey: 'Tipo',
		header: 'Tipo',
		cell: ({ row }) => {
			const tipo = row.getValue('Tipo') as string;
			return (
				<Badge variant={tipo === 'Ingreso' ? 'default' : 'destructive'} className='capitalize'>
					{tipo}
				</Badge>
			);
		},
	},
	{
		id: 'actions',
		cell: () => (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant='ghost' className='data-[state=open]:bg-muted text-muted-foreground flex size-8' size='icon'>
						<IconDotsVertical />
						<span className='sr-only'>Open menu</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-32'>
					<DropdownMenuItem>Editar</DropdownMenuItem>
					<DropdownMenuItem>Duplicar</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant='destructive'>Eliminar</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		),
	},
];

function DraggableRow({ row }: { row: Row<z.infer<typeof schema>> }) {
	const { transform, transition, setNodeRef, isDragging } = useSortable({
		id: row.original.ID,
	});

	return (
		<TableRow
			data-state={row.getIsSelected() && 'selected'}
			data-dragging={isDragging}
			ref={setNodeRef}
			className='relative z-0 data-[dragging=true]:z-10 data-[dragging=true]:opacity-80'
			style={{
				transform: CSS.Transform.toString(transform),
				transition: transition,
			}}
		>
			{row.getVisibleCells().map(cell => (
				<TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
			))}
		</TableRow>
	);
}

export function DataTable({ data: initialData }: { data: z.infer<typeof schema>[] }) {
	const [data, setData] = React.useState(() => initialData);
	const [rowSelection, setRowSelection] = React.useState({});
	const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
	const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
	const [sorting, setSorting] = React.useState<SortingState>([]);
	const [pagination, setPagination] = React.useState({
		pageIndex: 0,
		pageSize: 10,
	});
	const sortableId = React.useId();
	const sensors = useSensors(useSensor(MouseSensor, {}), useSensor(TouchSensor, {}), useSensor(KeyboardSensor, {}));

	const dataIds = React.useMemo<UniqueIdentifier[]>(() => data?.map(({ ID }) => ID) || [], [data]);

	const table = useReactTable({
		data,
		columns,
		state: {
			sorting,
			columnVisibility,
			rowSelection,
			columnFilters,
			pagination,
		},
		getRowId: row => row.ID.toString(),
		enableRowSelection: true,
		onRowSelectionChange: setRowSelection,
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange: setColumnVisibility,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFacetedRowModel: getFacetedRowModel(),
		getFacetedUniqueValues: getFacetedUniqueValues(),
	});

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		if (active && over && active.id !== over.id) {
			setData((data: z.infer<typeof schema>[]) => {
				const oldIndex = dataIds.indexOf(active.id);
				const newIndex = dataIds.indexOf(over.id);
				return arrayMove(data, oldIndex, newIndex);
			});
		}
	}

	return (
		<Tabs defaultValue='outline' className='w-full flex-col justify-start gap-6'>
			<div className='flex items-center justify-between px-4 lg:px-6'>
				<Label htmlFor='view-selector' className='sr-only'>
					View
				</Label>
				<Select defaultValue='outline'>
					<SelectTrigger className='flex w-fit @4xl/main:hidden' size='sm' id='view-selector'>
						<SelectValue placeholder='Select a view' />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='outline'>Outline</SelectItem>
						<SelectItem value='past-performance'>Past Performance</SelectItem>
						<SelectItem value='key-personnel'>Key Personnel</SelectItem>
						<SelectItem value='focus-documents'>Focus Documents</SelectItem>
					</SelectContent>
				</Select>
				<TabsList className='**:data-[slot=badge]:bg-muted-foreground/30 hidden **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:px-1 @4xl/main:flex'>
					<TabsTrigger value='outline'>Outline</TabsTrigger>
					<TabsTrigger value='past-performance'>
						Past Performance <Badge variant='secondary'>3</Badge>
					</TabsTrigger>
					<TabsTrigger value='key-personnel'>
						Key Personnel <Badge variant='secondary'>2</Badge>
					</TabsTrigger>
					<TabsTrigger value='focus-documents'>Focus Documents</TabsTrigger>
				</TabsList>
				<div className='flex items-center gap-2'>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant='outline' size='sm' className='hidden'>
								<span className='hidden lg:inline'>Customize Columns</span>
								<span className='lg:hidden'>Columns</span>
								<IconChevronDown />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end' className='w-56'>
							{table
								.getAllColumns()
								.filter(column => typeof column.accessorFn !== 'undefined' && column.getCanHide())
								.map(column => {
									return (
										<DropdownMenuCheckboxItem
											key={column.id}
											className='capitalize'
											checked={column.getIsVisible()}
											onCheckedChange={value => column.toggleVisibility(!!value)}
										>
											{column.id}
										</DropdownMenuCheckboxItem>
									);
								})}
						</DropdownMenuContent>
					</DropdownMenu>
					<Button variant='outline' size='sm'>
						<IconPlus />
						<span className='hidden lg:inline'>Add Section</span>
					</Button>
				</div>
			</div>
			<TabsContent value='outline' className='relative flex flex-col gap-4 overflow-auto px-4 lg:px-6'>
				<div className='overflow-hidden rounded-lg border'>
					<DndContext
						collisionDetection={closestCenter}
						modifiers={[restrictToVerticalAxis]}
						onDragEnd={handleDragEnd}
						sensors={sensors}
						id={sortableId}
					>
						<Table>
							<TableHeader className='bg-muted sticky top-0 z-10'>
								{table.getHeaderGroups().map(headerGroup => (
									<TableRow key={headerGroup.id}>
										{headerGroup.headers.map(header => {
											return (
												<TableHead key={header.id} colSpan={header.colSpan}>
													{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
												</TableHead>
											);
										})}
									</TableRow>
								))}
							</TableHeader>
							<TableBody className='**:data-[slot=table-cell]:first:w-8'>
								{table.getRowModel().rows?.length ? (
									<SortableContext items={dataIds} strategy={verticalListSortingStrategy}>
										{table.getRowModel().rows.map(row => (
											<DraggableRow key={row.id} row={row} />
										))}
									</SortableContext>
								) : (
									<TableRow>
										<TableCell colSpan={columns.length} className='h-24 text-center'>
											No results.
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</DndContext>
				</div>
				<div className='flex items-center justify-between px-4'>
					<div className='text-muted-foreground hidden flex-1 text-sm lg:flex'>
						{table.getFilteredSelectedRowModel().rows.length} of {table.getFilteredRowModel().rows.length} row(s) selected.
					</div>
					<div className='flex w-full items-center gap-8 lg:w-fit'>
						<div className='hidden items-center gap-2 lg:flex'>
							<Label htmlFor='rows-per-page' className='text-sm font-medium'>
								Rows per page
							</Label>
							<Select
								value={`${table.getState().pagination.pageSize}`}
								onValueChange={value => {
									table.setPageSize(Number(value));
								}}
							>
								<SelectTrigger size='sm' className='w-20' id='rows-per-page'>
									<SelectValue placeholder={table.getState().pagination.pageSize} />
								</SelectTrigger>
								<SelectContent side='top'>
									{[10, 20, 30, 40, 50].map(pageSize => (
										<SelectItem key={pageSize} value={`${pageSize}`}>
											{pageSize}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className='flex w-fit items-center justify-center text-sm font-medium'>
							Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
						</div>
						<div className='ml-auto flex items-center gap-2 lg:ml-0'>
							<Button
								variant='outline'
								className='hidden h-8 w-8 p-0 lg:flex'
								onClick={() => table.setPageIndex(0)}
								disabled={!table.getCanPreviousPage()}
							>
								<span className='sr-only'>Go to first page</span>
								<IconChevronsLeft />
							</Button>
							<Button variant='outline' className='size-8' size='icon' onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
								<span className='sr-only'>Go to previous page</span>
								<IconChevronLeft />
							</Button>
							<Button variant='outline' className='size-8' size='icon' onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
								<span className='sr-only'>Go to next page</span>
								<IconChevronRight />
							</Button>
							<Button
								variant='outline'
								className='hidden size-8 lg:flex'
								size='icon'
								onClick={() => table.setPageIndex(table.getPageCount() - 1)}
								disabled={!table.getCanNextPage()}
							>
								<span className='sr-only'>Go to last page</span>
								<IconChevronsRight />
							</Button>
						</div>
					</div>
				</div>
			</TabsContent>
			<TabsContent value='past-performance' className='flex flex-col px-4 lg:px-6'>
				<div className='aspect-video w-full flex-1 rounded-lg border border-dashed'></div>
			</TabsContent>
			<TabsContent value='key-personnel' className='flex flex-col px-4 lg:px-6'>
				<div className='aspect-video w-full flex-1 rounded-lg border border-dashed'></div>
			</TabsContent>
			<TabsContent value='focus-documents' className='flex flex-col px-4 lg:px-6'>
				<div className='aspect-video w-full flex-1 rounded-lg border border-dashed'></div>
			</TabsContent>
		</Tabs>
	);
}
