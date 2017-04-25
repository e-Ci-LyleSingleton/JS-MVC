interface EventHandler
{
    ( sender: any, args: any ): void;
};

class Event
{
    private publisher: any;
    private subscribers: EventHandler[];

    constructor( publisher: any )
    {
        this.publisher = publisher;
        this.subscribers = [];
    }
    public Subscribe( subscriber: EventHandler ): boolean
    {
        if ( typeof subscriber == "function" )
        {
            this.subscribers.push( subscriber );
            return true;
        }
        return false;
    }
    public Unsubscribe( subscriber: EventHandler ): boolean
    {
        for ( let i = this.subscribers.length - 1; i >= 0; i-- )
        {
            if ( this.subscribers[i] === subscriber )
            {
                this.subscribers.splice( i, 1 );
                return true;
            }
        }
        return false;
    }
    public Raise( args: any ): void
    {
        for ( let i = this.subscribers.length - 1; i >= 0; i-- )
        {
            this.subscribers[i]( this.publisher, args );
        }
    }
}

class SlotMapKey
{
    private key: number;

    constructor( index )
    {
        this.key = 0;
        this.SetIndex( index );
        this.SetVersion( 1 );
    }
    public static GetVersion( key: number ): number
    {
        // they version is stored in the lower 16 bits of the number
        return key & 0x0000FFFF;
    }
    public static GetIndex( key: number ): number
    {
        // they index is stored in the upper 16 bits of the number, push down to the lower 16 bits and mask for 16 bit overflow
        return ( key >> 16 ) & 0x0000FFFF;
    }
    public Key(): number
    {
        return this.key;
    }
    public IncrementVersion(): void
    {
        // get the existing version +1 and set it
        this.SetVersion(( this.key & 0x0000FFFF ) + 1 );
    }
    private SetIndex( newIndex: number )
    {
        // discard the existing index, and update with the new one masked for 16 bit overflow
        this.key = ( this.key & 0x0000FFFF ) + ( ( newIndex & 0x0000FFFF ) << 16 );
    }
    private SetVersion( newVersion: number )
    {
        // discard the existing version, and update with the new one masked for 16 bit overflow
        this.key = ( this.key & 0xFFFF0000 ) + ( newVersion & 0x0000FFFF );
    }

}

class SlotMapObj<dataType> extends SlotMapKey
{
    value: dataType;
}

class SlotMap<dataType>
{
    static maxAllocationSize: number = ( 1 << 15 );
    private itemList: SlotMapObj<dataType>[];
    private maxItems: number;
    private freeList: number[];

    constructor( maxItems: number )
    {
        if ( maxItems > SlotMap.maxAllocationSize )
        {
            throw new Error( "Trying to initialise the slotmap with more than " + SlotMap.maxAllocationSize + " items is not possible due to JS max number size constraints" );
        }
        this.maxItems = maxItems;
        this.itemList = [];//new SlotMapObj[this.maxItems]();
        this.freeList = [];
        for ( let i = this.maxItems - 1; i >= 0; i-- )
        {
            this.itemList[i] = new SlotMapObj<dataType>( i );
            this.freeList.push( i );
        }
    }
    public AllocateItem(): number
    {
        if ( !this.IsFull() )
        {
            // get the most recently released location in the array
            let index = this.freeList[this.freeList.length - 1];
            
            // remove the most recent index from the list of available locations
            this.freeList.pop();

            // inform the requester of the key to access the item
            return this.itemList[index].Key();
        }
        return null;
    }
    public ReleaseItem( id: number ): void
    {
        let index: number = SlotMapKey.GetIndex( id );
        let version: number = SlotMapKey.GetVersion( id );
        let key: number;
        let result: SlotMapObj<dataType>;

        // Array bound check
        if ( index < this.maxItems )
        {
            key = this.itemList[index].Key();

            // Item version check
            if ( SlotMapKey.GetVersion( key ) == version )
            {
                // request JS to release the observer handle
                delete this.itemList[index].value;

                // recreate the 'value' attribute
                this.itemList[index].value = null;

                // stop this item from being accessed the the id passed in
                this.itemList[index].IncrementVersion();

                // Add the new index to the list of usable locations
                this.freeList.push( index );
            }
        }
    }
    public GetItemByID( id: number ): SlotMapObj<dataType>
    {
        let index: number = SlotMapKey.GetIndex( id );
        let version: number = SlotMapKey.GetVersion( id );
        let key: number;
        let result: SlotMapObj<dataType>;

        // Array bound check
        if ( index < this.maxItems )
        {
            key = this.itemList[index].Key();
            // Item version check
            if ( SlotMapKey.GetVersion( key ) == version )
            {
                return this.itemList[index];
            }
        }
        console.warn( "Attempting to get SlotMapItem using an expired id" );
        return null;
    }
    public IsFull(): boolean
    {
        return this.freeList.length == 0;
    }
}

class Model
{
    public onLoading: Event;
    public onLoaded: Event;
    public onProcessing: Event;
    public onProcessed: Event;
    public onItemUpdated: Event;
    private isInitialised: boolean;

    constructor()
    {
        this.isInitialised = false;
        this.onLoading = new Event( this );
        this.onLoaded = new Event( this );
        this.onProcessing = new Event( this );
        this.onProcessed = new Event( this );
        this.onItemUpdated = new Event( this );
    }
    public IsInitialised(): boolean
    {
        return this.isInitialised;
    }
}

class CollectionSubModel extends Model
{
    public onFilterChanged: Event;
    constructor()
    {
        super();
        this.onFilterChanged = new Event( this );
    }
    public SetFilter( filterAttributes: any, preventEvent )
    {
        console.warn( "CollectionSubModel SetFilter not implemented" );
    }
}

class CollectionModel extends Model
{
    public onItemAdded: Event;
    public onItemRemoved: Event;

    protected itemCollection: SlotMap<CollectionSubModel>;
    protected itemHandleCollection: number[];

    constructor()
    {
        super();
        this.onItemAdded = new Event( this );
        this.onItemRemoved = new Event( this );
        this.itemCollection = new SlotMap<CollectionSubModel>( 128 );
        this.itemHandleCollection = [];
    }
    public AddItem( item: CollectionSubModel, preventEvent: boolean ): number
    {
        // Ask the slotmap to allocate an item
        let itemHandle: number = this.itemCollection.AllocateItem();
        if ( itemHandle !== null )
        {
            this.itemHandleCollection.push( itemHandle );
            let itemStorage: SlotMapObj<Model> = this.itemCollection.GetItemByID( itemHandle );

            itemStorage.value = item;

            if ( !preventEvent )
                this.onItemAdded.Raise( itemHandle );

        }
        return itemHandle;
    }
    public GetItem( handle: number ): CollectionSubModel
    {
        let item = this.itemCollection.GetItemByID( handle );
        if ( item != null )
        {
            return item.value;
        }
        return null;
    }
    public RemoveItem( handle: number, preventEvent: boolean )
    {
        this.itemCollection.ReleaseItem( handle );
        let collectionIndex: number = this.itemHandleCollection.indexOf( handle );

        if ( collectionIndex >= 0 )
        {
            this.itemHandleCollection.splice( collectionIndex, 1 );
        }

        if ( !preventEvent )
            this.onItemRemoved.Raise( handle );

    }
    protected FilterItems( filterAttributes: any, preventEvent: boolean )
    {
        let tempSubModel: CollectionSubModel;
        for ( let i = this.itemHandleCollection.length - 1; i >= 0; i-- )
        {
            tempSubModel = this.GetItem( this.itemHandleCollection[i] );
            tempSubModel.SetFilter( filterAttributes, false );
        }
    }
}

class View
{
    constructor()
    {
    }
    protected Render(): any
    {
        console.log( "View Render not handled" );
    };
    protected OnItemUpdated( sender: any, args: any )
    {
        console.log( "View OnItemUpdated not handled" );
    }
    protected OnLoaded( sender: any, args: any )
    {
        console.log( "View OnLoaded not handled" );
    }
    protected OnLoading( sender: any, args: any )
    {
        console.log( "View OnLoading not handled" );
    }
    protected OnProcessed( sender: any, args: any )
    {
        console.log( "View OnProcessed not handled" );
    }
    protected OnProcessing( sender: any, args: any )
    {
        console.log( "View OnProcessing not handled" );
    }
}

class CollectionSubView extends View
{
    protected modelHandle: number;
    protected collectionModel: CollectionModel;

    constructor( modelHandle: number, collectionModel: CollectionModel )
    {
        super();
        this.modelHandle = modelHandle;
        this.collectionModel = collectionModel;

        let model = collectionModel.GetItem( this.modelHandle );
        if ( model != null )
        {
            model.onItemUpdated.Subscribe( this.OnItemUpdated.bind( this ) );
            model.onLoaded.Subscribe( this.OnLoaded.bind( this ) );
            model.onLoading.Subscribe( this.OnLoading.bind( this ) );
            model.onProcessed.Subscribe( this.OnProcessed.bind( this ) );
            model.onProcessing.Subscribe( this.OnProcessing.bind( this ) );
            model.onFilterChanged.Subscribe( this.OnFilterUpdated.bind( this ) );
        }
    }
    protected Render(): any
    {
        console.log( "CollectionSubView Render not handled" );
    };
    protected OnItemUpdated( sender: any, args: any )
    {
        console.log( "CollectionSubView OnItemUpdated not handled" );
    }
    protected OnLoaded( sender: any, args: any )
    {
        console.log( "CollectionSubView OnLoaded not handled" );
    }
    protected OnLoading( sender: any, args: any )
    {
        console.log( "CollectionSubView OnLoading not handled" );
    }
    protected OnProcessed( sender: any, args: any )
    {
        console.log( "CollectionSubView OnProcessed not handled" );
    }
    protected OnProcessing( sender: any, args: any )
    {
        console.log( "CollectionSubView OnProcessing not handled" );
    }
    protected OnFilterUpdated( sender: any, args: any )
    {
        console.log( "CollectionSubView OnFilterUpdated not handled" );
    }
}

class CollectionView extends View
{
    protected subViews: CollectionSubView[];
    protected model: CollectionModel;

    constructor( model: CollectionModel )
    {
        super();
        this.model = model;
        this.subViews = [];
        model.onItemAdded.Subscribe( this.OnItemAdded.bind( this ) );
        model.onItemRemoved.Subscribe( this.OnItemRemoved.bind( this ) );
        model.onLoaded.Subscribe( this.OnLoaded.bind( this ) );
        model.onLoading.Subscribe( this.OnLoading.bind( this ) );
        model.onProcessed.Subscribe( this.OnProcessed.bind( this ) );
        model.onProcessing.Subscribe( this.OnProcessing.bind( this ) );
    }
    protected OnItemAdded( sender: any, args: any )
    {
        this.subViews.push( new QATemplateCollectionSubView( args, this.model ) );
        //console.log( "CollectionView OnItemAdded not handled" );
    }
    protected OnItemRemoved( sender: any, args: any )
    {
        console.log( "CollectionView OnItemRemoved not handled" );
    }
    protected OnLoaded( sender: any, args: any )
    {
        console.log( "CollectionView OnLoaded not handled" );
    }
    protected OnLoading( sender: any, args: any )
    {
        console.log( "CollectionView OnLoading not handled" );
    }
    protected OnProcessed( sender: any, args: any )
    {
        console.log( "CollectionView OnProcessed not handled" );
    }
    protected OnProcessing( sender: any, args: any )
    {
        console.log( "CollectionView OnProcessing not handled" );
    }
}

// Begin instance classes

class QATemplateCollectionSubView extends CollectionSubView
{
    constructor( modelHandle: number, collectionModel: CollectionModel )
    {
        super( modelHandle, collectionModel );
    }
    protected Render(): any
    {
        console.log( "QATemplateCollectionSubView Render" );
    }
    protected OnItemUpdated( sender: any, args: any )
    {
        console.log( "QATemplateCollectionSubView OnItemUpdated" );
        this.Render();
    }
    protected OnFilterChanged( sender: any, args: any )
    {
        console.log( "QATemplateCollectionSubView OnFilterChanged" );
        this.Render();
    }
}

class QATemplateCollectionView extends CollectionView
{
    public onFilterChanged: Event;

    constructor( model: CollectionModel )
    {
        super( model );
        this.onFilterChanged = new Event( this );
    }
    protected Render(): any
    {
        console.log( "QATemplateCollectionView Render" );
    }
    protected OnItemAdded( sender: any, args: any )
    {
        super.OnItemAdded( sender, args );
        console.log( "QATemplateCollectionView OnItemAdded" );
        //this.Render();
    }
    protected OnItemRemoved( sender: any, args: any )
    {
        console.log( "QATemplateCollectionView OnItemRemoved" );
        this.Render();
    }
}

class QATemplateModel extends CollectionSubModel
{
    name: string;
    isVisible: boolean;

    constructor( startingName: string )
    {
        super();
        this.name = startingName;
        this.onFilterChanged.Raise( {});
        this.isVisible = true;

    }
    public SetFilter( filterAttributes: any, preventEvent: boolean ): void
    {
        let startingVisibility: boolean = this.isVisible;

        this.isVisible = true;

        if ( filterAttributes["name"] != this.name )
        {
            this.isVisible = false;
        }
        else
        {
            console.log( "matched on Name" );
        }

        if ( !preventEvent && startingVisibility != this.isVisible )
            this.onFilterChanged.Raise( {});
    }
}

class QATemplateCollectionModel extends CollectionModel
{
    constructor()
    {
        super();
    }

    public GetAllItems(): void
    {
        this.onLoading.Raise( {});

        // Simulate callback
        this.APIQueryResult();
        // End simulation
    }
    private APIQueryResult()
    {
        this.onLoaded.Raise( {});
        this.onProcessing.Raise( {});

        this.AddItem( new QATemplateModel( "Harold" ), false );
        this.AddItem( new QATemplateModel( " Mike " ), false );

        let oldhandle = this.AddItem( new QATemplateModel( "Gerald" ), false );


        this.AddItem( new QATemplateModel( "Gray" ), false );
        this.RemoveItem( oldhandle, false );

        this.AddItem( new QATemplateModel( "Borris" ), false );
        this.GetItem( oldhandle );

        this.AddItem( new QATemplateModel( "Borris" ), false );
        this.AddItem( new QATemplateModel( "Borris" ), false );
        this.AddItem( new QATemplateModel( "borris" ), false );
        this.AddItem( new QATemplateModel( "Gerry" ), false );

        this.onProcessed.Raise( {});

        this.FilterItems( { name: "Gerry" }, false );
    }
}

class QATemplateController
{
    model: QATemplateCollectionModel;
    view: QATemplateCollectionView;
    constructor()
    {
        this.model = new QATemplateCollectionModel();
        this.view = new QATemplateCollectionView( this.model );

        this.view.onFilterChanged.Subscribe( this.OnViewFilterChanged.bind( this ) );
        this.model.GetAllItems();
    }
    private OnViewFilterChanged( sender: any, args: any )
    {
        //this.model.SetFilter( args );
    }
}

new QATemplateController();
