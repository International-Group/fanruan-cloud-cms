import type { Schema, Struct } from '@strapi/strapi';

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: '';
    displayName: 'Seo';
    icon: 'allergies';
    name: 'Seo';
  };
  attributes: {
    metaDescription: Schema.Attribute.Text & Schema.Attribute.Required;
    metaTitle: Schema.Attribute.String & Schema.Attribute.Required;
    shareImage: Schema.Attribute.Media<'images'>;
  };
}

export interface SharedTag extends Struct.ComponentSchema {
  collectionName: 'components_shared_tags';
  info: {
    displayName: 'tag';
    icon: 'priceTag';
  };
  attributes: {
    tag: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface TemplateSupported extends Struct.ComponentSchema {
  collectionName: 'components_template_supporteds';
  info: {
    displayName: 'supported';
    icon: 'layer';
  };
  attributes: {
    product_logo: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios'
    >;
    product_name: Schema.Attribute.Enumeration<
      ['finebi', 'finereport', 'fvs']
    > &
      Schema.Attribute.Required;
    version: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'shared.seo': SharedSeo;
      'shared.tag': SharedTag;
      'template.supported': TemplateSupported;
    }
  }
}
