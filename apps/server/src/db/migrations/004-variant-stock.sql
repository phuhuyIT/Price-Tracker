ALTER TABLE product_variants
ADD COLUMN current_stock_quantity INTEGER
CHECK (
    current_stock_quantity IS NULL
    OR (
        typeof(current_stock_quantity) = 'integer'
        AND current_stock_quantity >= 0
        AND (
            (current_stock_quantity = 0 AND current_availability = 'sold_out')
            OR (current_stock_quantity > 0 AND current_availability = 'available')
        )
    )
);

ALTER TABLE variant_check_results
ADD COLUMN stock_quantity INTEGER
CHECK (
    stock_quantity IS NULL
    OR (
        typeof(stock_quantity) = 'integer'
        AND stock_quantity >= 0
        AND presence = 'present'
        AND (
            (stock_quantity = 0 AND availability = 'sold_out')
            OR (stock_quantity > 0 AND availability = 'available')
        )
    )
);
