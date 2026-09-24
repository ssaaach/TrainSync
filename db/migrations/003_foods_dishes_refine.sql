-- Several ingredients map to one USDA row (documented proxies, e.g. poha ->
-- raw white rice), so fdc_id cannot be unique; ingredient_key is the natural key.
ALTER TABLE foods DROP INDEX uq_foods_fdc;
ALTER TABLE foods ADD INDEX idx_foods_fdc (fdc_id);
ALTER TABLE foods MODIFY ingredient_key VARCHAR(60) NOT NULL;
ALTER TABLE foods ADD COLUMN usda_description VARCHAR(255) NULL;
ALTER TABLE foods ADD COLUMN proxy_note VARCHAR(255) NULL;
ALTER TABLE foods ADD COLUMN diet_class ENUM('plant','dairy','honey','egg','meat','fish','shellfish') NOT NULL DEFAULT 'plant';
ALTER TABLE foods ADD COLUMN jain_excluded TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE foods ADD COLUMN allergens JSON NULL;
ALTER TABLE foods ADD COLUMN is_staple_extra TINYINT(1) NOT NULL DEFAULT 0;

-- Diet prefs a dish satisfies, derived from its ingredients
-- (e.g. ["vegan","veg","eggetarian","non-veg"] or with "jain").
ALTER TABLE dishes ADD COLUMN suitable_for JSON NULL;
ALTER TABLE dishes ADD COLUMN cuisine VARCHAR(40) NULL;
